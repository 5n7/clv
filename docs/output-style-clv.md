# clv output style

Copy this file into your `CLAUDE.md` or save it as `~/.claude/output-styles/clv.md` so Claude Code emits Markdown that the `clv` CLI can render richly.

> Tip: run `clv doc` for the full showcase (all 14 block types), or `clv doc <block>` for one block's schema + example.

---

When producing review or explanation output, embed structured data using **clv blocks**. A clv block is a fenced code block whose info string is `clv:<type>` and whose body is a single JSON object:

````markdown
```clv:callout title="N+1 detected"
{ "kind": "warning", "body": "ListOrders issues one query per row." }
```
````

Rules:

- Use **only** the 14 block types listed below (in alphabetical order). Do **not** invent new block names — an unknown `clv:<type>` renders as a raw-JSON fallback, not a rich block.
- The body must be **valid JSON**: double-quoted keys/strings, no comments, no trailing commas. It must parse with `JSON.parse`.
- Header attributes such as `title="…"` are merged into the payload (the JSON body wins on conflict). Prefer putting fields in the JSON body.
- Every block may include the common optional fields `title` (string), `collapsed` (boolean), and `id` (string, used as an anchor target). In the schemas below they are listed first, matching the code.
- Markdown is allowed inside any field documented as "Markdown".
- For Mermaid diagrams you may use a bare `` ```mermaid `` fence (no `clv:` prefix); the whole fence body is taken as the diagram source.

Shared enums:

- `Severity`: `"info" | "tip" | "warning" | "danger" | "critical"`
- `Status`: `"pass" | "fail" | "na" | "skip"`
- `FileChange`: `"added" | "modified" | "deleted" | "renamed"`
- `Trend`: `"up" | "down" | "neutral"`
- `ChartType`: `"bar" | "line" | "pie" | "area" | "scatter"`

Nested block shape (used inside `clv:tabs` and `clv:steps`):

```json
{ "type": "<type>", "data": { ... } }
```

---

## Block schemas

### `clv:callout` — alert / summary / tip

```json
{
	"title": "string?",
	"collapsed": "boolean?",
	"id": "string?",
	"kind": "Severity",
	"body": "string (Markdown)"
}
```

**Example:**

```clv:callout
{ "title": "N+1 detected", "kind": "warning", "body": "`ListOrders` issues one query per row." }
```

### `clv:chart` — data visualization

```json
{
	"title": "string?",
	"collapsed": "boolean?",
	"id": "string?",
	"type": "ChartType",
	"data": [{ "<key>": "string | number" }],
	"xKey": "string (key into data rows for the x axis)",
	"yKeys": ["string (one or more series keys)"],
	"stacked": "boolean?",
	"height": "number? (default 280)"
}
```

**Example:**

```clv:chart
{
	"title": "Requests per minute",
	"type": "line",
	"xKey": "time",
	"yKeys": ["ok", "error"],
	"data": [
		{ "time": "09:00", "ok": 820, "error": 4 },
		{ "time": "09:05", "ok": 1100, "error": 9 }
	]
}
```

### `clv:checklist` — quality gate

```json
{
	"title": "string?",
	"collapsed": "boolean?",
	"id": "string?",
	"items": [
		{ "label": "string", "status": "Status", "note": "string?" }
	]
}
```

**Example:**

```clv:checklist
{
	"title": "Release gate",
	"items": [
		{ "label": "Unit tests pass", "status": "pass" },
		{ "label": "Load test at 2× peak", "status": "fail", "note": "p95 regressed" },
		{ "label": "Mobile impact", "status": "na", "note": "backend only" }
	]
}
```

### `clv:code` — annotated code

```json
{
	"title": "string?",
	"collapsed": "boolean?",
	"id": "string?",
	"lang": "string",
	"file": "string?",
	"source": "string (the code; use \\n for newlines)",
	"startLine": "number? (default 1)",
	"annotations": [
		{
			"line": "number (absolute, startLine-based)",
			"kind": "Severity?",
			"text": "string (Markdown)"
		}
	],
	"highlightLines": ["number"]
}
```

**Example:**

```clv:code
{
	"file": "queue.ts",
	"lang": "typescript",
	"startLine": 40,
	"highlightLines": [42],
	"source": "export async function enqueue(job: Job) {\n  const id = crypto.randomUUID();\n  await redis.lpush(\"pending\", JSON.stringify(job));\n  return id;\n}",
	"annotations": [
		{ "line": 42, "kind": "warning", "text": "No depth guard — a burst can grow `pending` unbounded." }
	]
}
```

### `clv:diff` — before/after diff

```json
{
	"title": "string?",
	"collapsed": "boolean?",
	"id": "string?",
	"lang": "string?",
	"file": "string?",
	"mode": "\"unified\" | \"split\"? (default split)",
	"from": "string (old code)",
	"to": "string (new code)"
}
```

**Example:**

```clv:diff
{
	"title": "Bound the pending list",
	"file": "queue.ts",
	"lang": "typescript",
	"mode": "unified",
	"from": "await redis.lpush(\"pending\", payload);",
	"to": "const depth = await redis.lpush(\"pending\", payload);\nif (depth > MAX) await redis.ltrim(\"pending\", 0, MAX - 1);"
}
```

### `clv:findings` — review findings

```json
{
	"title": "string?",
	"collapsed": "boolean?",
	"id": "string?",
	"items": [
		{
			"severity": "Severity",
			"file": "string?",
			"line": "number?",
			"title": "string",
			"body": "string? (Markdown)",
			"blockId": "string? (id of a clv:code block to jump to)"
		}
	]
}
```

**Example:**

```clv:findings
{
	"title": "Findings (2)",
	"items": [
		{ "severity": "warning", "file": "queue.ts", "line": 42, "title": "Unbounded pending list", "body": "Add a depth guard before Redis runs out of memory." },
		{ "severity": "info", "file": "worker.ts", "title": "Graceful shutdown looks good" }
	]
}
```

### `clv:graph` — node/edge diagram

```json
{
	"title": "string?",
	"collapsed": "boolean?",
	"id": "string?",
	"layout": "\"dagre\" | \"force\" | \"manual\"? (default dagre)",
	"direction": "\"TB\" | \"LR\"? (default LR; dagre only)",
	"nodes": [
		{
			"id": "string",
			"label": "string",
			"group": "string? (themed: api, svc, db, ext; aliases service, external)",
			"shape": "\"rect\" | \"circle\"?",
			"x": "number? (manual layout only)",
			"y": "number? (manual layout only)"
		}
	],
	"edges": [
		{
			"from": "node id",
			"to": "node id",
			"label": "string?",
			"style": "\"solid\" | \"dashed\"?"
		}
	]
}
```

**Example:**

```clv:graph
{
	"title": "Request path",
	"direction": "LR",
	"nodes": [
		{ "id": "api", "label": "API", "group": "api" },
		{ "id": "svc", "label": "Order service", "group": "svc" },
		{ "id": "db", "label": "Postgres", "group": "db" },
		{ "id": "pay", "label": "Stripe", "group": "ext" }
	],
	"edges": [
		{ "from": "api", "to": "svc", "label": "POST /orders" },
		{ "from": "svc", "to": "db" },
		{ "from": "svc", "to": "pay", "style": "dashed" }
	]
}
```

For `group`, prefer `api` / `svc` / `db` / `ext` to get the themed colors.
When `layout` is `"manual"`, every node must include both `x` and `y`.

### `clv:metrics` — KPI cards

```json
{
	"title": "string?",
	"collapsed": "boolean?",
	"id": "string?",
	"items": [
		{
			"label": "string",
			"value": "string | number",
			"delta": "string?",
			"trend": "Trend?",
			"hint": "string?"
		}
	],
	"columns": "2 | 3 | 4? (default 4)"
}
```

**Example:**

```clv:metrics
{
	"columns": 3,
	"items": [
		{ "label": "Jobs / min", "value": "1,240", "delta": "+9%", "trend": "up" },
		{ "label": "p95 latency", "value": "84 ms", "delta": "-12 ms", "trend": "down" },
		{ "label": "Failure rate", "value": "0.3%", "trend": "neutral", "hint": "watch this" }
	]
}
```

### `clv:mermaid` — Mermaid diagram

```json
{
	"title": "string?",
	"collapsed": "boolean?",
	"id": "string?",
	"source": "string (raw Mermaid text)"
}
```

**Example:**

```clv:mermaid
{ "title": "Job lifecycle", "source": "stateDiagram-v2\n  [*] --> Pending\n  Pending --> Running\n  Running --> Done\n  Done --> [*]" }
```

You may also write a bare `` ```mermaid `` fence instead of this block.

### `clv:steps` — step player

```json
{
	"title": "string?",
	"collapsed": "boolean?",
	"id": "string?",
	"steps": [
		{
			"title": "string",
			"body": "string? (Markdown)",
			"block": "Block? (a nested clv block)"
		}
	],
	"initial": "number? (0-based starting step)"
}
```

**Example:**

```clv:steps
{
	"title": "Apply the fix",
	"initial": 0,
	"steps": [
		{ "title": "Add the limit", "body": "Introduce `MAX_DEPTH` in `config.ts`." },
		{
			"title": "Trim on overflow",
			"body": "Trim the tail when the list exceeds the cap.",
			"block": {
				"type": "code",
				"data": { "lang": "typescript", "source": "if (depth > MAX_DEPTH) redis.ltrim(KEY, 0, MAX_DEPTH - 1);" }
			}
		}
	]
}
```

Each step uses either `body` or `block` (or both).

### `clv:table` — data table

```json
{
	"title": "string?",
	"collapsed": "boolean?",
	"id": "string?",
	"columns": [
		{
			"key": "string",
			"label": "string",
			"align": "\"left\" | \"right\" | \"center\"?",
			"lang": "string? (highlight cells)",
			"sortable": "boolean?"
		}
	],
	"rows": [{ "<column key>": "string | number" }],
	"caption": "string?"
}
```

**Example:**

```clv:table
{
	"title": "Queues",
	"columns": [
		{ "key": "queue", "label": "Queue", "align": "left", "sortable": true },
		{ "key": "depth", "label": "Depth", "align": "right", "sortable": true }
	],
	"rows": [
		{ "queue": "email", "depth": 12 },
		{ "queue": "thumbnails", "depth": 340 }
	],
	"caption": "Snapshot at 09:15"
}
```

### `clv:tabs` — tabbed panels

```json
{
	"title": "string?",
	"collapsed": "boolean?",
	"id": "string?",
	"tabs": [
		{
			"label": "string",
			"content": "string? (Markdown)",
			"block": "Block? (a nested clv block)"
		}
	]
}
```

**Example:**

```clv:tabs
{
	"title": "Backend options",
	"tabs": [
		{ "label": "Redis (chosen)", "content": "Operated in-house; `lpush`/`brpop` give us at-least-once." },
		{
			"label": "Config",
			"block": {
				"type": "code",
				"data": { "lang": "typescript", "source": "export const MAX_DEPTH = 50_000;" }
			}
		}
	]
}
```

Each tab uses either `content` or `block` (or both).

### `clv:timeline` — phases / events

```json
{
	"title": "string?",
	"collapsed": "boolean?",
	"id": "string?",
	"orientation": "\"vertical\" | \"horizontal\"? (reserved; only vertical is implemented — horizontal is not yet rendered)",
	"events": [
		{
			"at": "string (free label: \"step 1\", \"10:23\", \"2026-05-20\")",
			"title": "string",
			"body": "string? (Markdown)",
			"kind": "Severity?"
		}
	]
}
```

**Example:**

```clv:timeline
{
	"title": "Rollout plan",
	"events": [
		{ "at": "day 1", "title": "Ship behind flag", "kind": "info" },
		{ "at": "day 2", "title": "Enable in staging", "body": "Soak for 24h.", "kind": "tip" },
		{ "at": "day 4", "title": "Ramp prod to 50%", "kind": "warning" }
	]
}
```

### `clv:tree` — changed-file tree

```json
{
	"title": "string?",
	"collapsed": "boolean?",
	"id": "string?",
	"nodes": [
		{
			"path": "a/b/c.go (slashes = hierarchy)",
			"status": "FileChange?",
			"note": "string?",
			"href": "string? (http(s), mailto, #anchor, or relative path)"
		}
	]
}
```

**Example:**

```clv:tree
{
	"title": "Files in this change",
	"nodes": [
		{ "path": "src/queue.ts", "status": "modified", "note": "bounded enqueue", "href": "#code-enqueue" },
		{ "path": "src/config.ts", "status": "added", "note": "new MAX_DEPTH" },
		{ "path": "docs/queue.md", "status": "renamed", "href": "./queue.md" }
	]
}
```
