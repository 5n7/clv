import type { Document } from "@shared/types";

// Sample Document the clv CLI would inject as window.__CLV_DATA__.
// Mirrors .design-reference/project/data.jsx, reshaped to match the SPEC §7/§8.2
// types: markdown nodes carry raw source, tabs use `content`, steps use
// `body`/`block`. Used by `bun run dev:web` for UI iteration.
export const devData: Document = {
	title: "PR #482 — checkout: rework order pipeline",
	subtitle: "reviewed by Claude Code · clv 0.1.0 · 14 blocks · 6 findings",
	source: "review.md",
	generated: "2026-05-20 14:02",
	theme: "auto",
	nodes: [
		{
			kind: "markdown",
			markdown:
				"## Summary\n\nThis PR refactors the order-placement pipeline in `server/checkout` to introduce an outbox-based eventing model. The change is broadly headed in a good direction, but there are **two correctness issues** in `order_service.go` that block merge, plus a few _perf_ concerns we should land before traffic ramp.\n\nI read 14 files across 4 packages and ran the test suite. Findings are anchored to specific code blocks below — click a finding to jump.",
		},

		{
			kind: "block",
			block: {
				type: "metrics",
				data: {
					id: "metrics-summary",
					title: "Pull request at a glance",
					columns: 4,
					items: [
						{ label: "Files changed", value: 14, delta: "+3", trend: "up", hint: "vs. baseline branch" },
						{ label: "Net LOC", value: "+486", delta: "−112 deleted", trend: "neutral" },
						{
							label: "Test coverage",
							value: "84.2%",
							delta: "+1.2pt",
							trend: "up",
							hint: "lines covered, package weighted",
						},
						{ label: "p95 latency", value: "118 ms", delta: "−27 ms", trend: "down", hint: "from synthetic benchmark" },
					],
				},
			},
		},

		{
			kind: "block",
			block: {
				type: "callout",
				data: {
					id: "blocking",
					title: "Blocking before merge",
					kind: "danger",
					body: "Two correctness issues — duplicate outbox emission on retry, and a missing context cancellation in `ListOrders` — must be fixed before this can land. Both are flagged in the findings table below.",
				},
			},
		},

		{
			kind: "block",
			block: {
				type: "tree",
				data: {
					id: "files",
					title: "Files changed",
					nodes: [
						{
							path: "server/checkout/order_service.go",
							status: "modified",
							note: "core changes",
							href: "#code-order-service",
						},
						{ path: "server/checkout/order_service_test.go", status: "modified", note: "new cases" },
						{ path: "server/checkout/outbox.go", status: "added", note: "new", href: "#code-outbox" },
						{ path: "server/checkout/outbox_test.go", status: "added" },
						{ path: "server/checkout/types.go", status: "modified" },
						{ path: "server/checkout/legacy_emitter.go", status: "deleted" },
						{ path: "server/checkout/handlers/place_order.go", status: "modified" },
						{ path: "server/checkout/handlers/refund.go", status: "modified" },
						{ path: "server/checkout/migrations/0014_outbox.sql", status: "added" },
						{ path: "server/checkout/migrations/0015_index.sql", status: "added" },
						{ path: "client/orders/state.ts", status: "modified" },
						{ path: "client/orders/api.ts", status: "renamed", note: "from client/orders/client.ts" },
						{ path: "docs/architecture/checkout.md", status: "modified" },
						{ path: "docs/architecture/checkout.png", status: "deleted" },
					],
				},
			},
		},

		{
			kind: "block",
			block: {
				type: "findings",
				data: {
					id: "findings",
					title: "Findings (7)",
					items: [
						{
							severity: "critical",
							file: "server/checkout/order_service.go",
							line: 142,
							blockId: "code-order-service",
							title: "Duplicate outbox emission on retry",
							body: "`PlaceOrder` writes to the outbox **after** the transaction commits. On a transient retry (network blip → client re-issues), the same intent is committed twice with different `event_id`s. Move the outbox insert inside the same `tx`.",
						},
						{
							severity: "critical",
							file: "server/checkout/order_service.go",
							line: 154,
							blockId: "code-order-service",
							title: "Context not propagated to ListOrders query",
							body: "`ListOrders` calls `db.QueryContext(context.Background(), ...)` — a request cancellation will not interrupt the query, exhausting the connection pool under load.",
						},
						{
							severity: "warning",
							file: "server/checkout/outbox.go",
							line: 64,
							blockId: "code-outbox",
							title: "Unbounded fetch in poller",
							body: "`fetchPending` selects without a `LIMIT`. On backlog it will load thousands of rows into memory. Suggest `LIMIT 200` + cursor.",
						},
						{
							severity: "warning",
							file: "server/checkout/handlers/refund.go",
							line: 31,
							title: "Refund handler still uses legacy emitter import",
							body: "Stale import after deletion of `legacy_emitter.go`. Compiles via build tags but will break once tags are removed in #487.",
						},
						{
							severity: "tip",
							file: "client/orders/api.ts",
							line: 12,
							title: "Consider AbortController for in-flight requests",
							body: "Now that the server respects cancellation, the client can wire up `AbortController` to drop stale fetches when the route changes.",
						},
						{
							severity: "info",
							file: "docs/architecture/checkout.md",
							title: "Diagram replaced with Mermaid source",
							body: "Good move — easier to keep in sync. The new diagram is rendered below.",
						},
						{
							severity: "tip",
							file: "server/checkout/order_service.go",
							line: 4,
							blockId: "code-step-today",
							title: "See the step-by-step fix in the walkthrough",
							body: "This finding's snippet is sourced from a `clv:code` block nested inside the steps walkthrough — proving the code index descends into recursive containers.",
						},
					],
				},
			},
		},

		{
			kind: "markdown",
			markdown:
				"## Core change — `order_service.go`\n\nThe interesting changes are concentrated in `PlaceOrder` and `ListOrders`. Two annotations are flagged as **critical**; jump from the findings panel above.",
		},

		{
			kind: "block",
			block: {
				type: "code",
				data: {
					id: "code-order-service",
					title: "server/checkout/order_service.go",
					file: "server/checkout/order_service.go",
					lang: "go",
					startLine: 130,
					highlightLines: [],
					source: [
						"func (s *OrderService) PlaceOrder(ctx context.Context, req PlaceOrderRequest) (*Order, error) {",
						"    tx, err := s.db.BeginTx(ctx, nil)",
						"    if err != nil {",
						'        return nil, fmt.Errorf("begin tx: %w", err)',
						"    }",
						"    defer tx.Rollback()",
						"",
						"    order, err := s.insertOrder(ctx, tx, req)",
						"    if err != nil {",
						"        return nil, err",
						"    }",
						"",
						"    if err := tx.Commit(); err != nil {",
						'        return nil, fmt.Errorf("commit: %w", err)',
						"    }",
						"",
						"    // Outbox is written AFTER commit — see review.",
						"    if err := s.outbox.Emit(ctx, OrderPlaced{ID: order.ID}); err != nil {",
						'        log.Warnf("outbox emit failed: %v", err)',
						"    }",
						"    return order, nil",
						"}",
						"",
						"func (s *OrderService) ListOrders(userID string) ([]Order, error) {",
						"    rows, err := s.db.QueryContext(context.Background(),",
						"        `SELECT id, total FROM orders WHERE user_id = $1`, userID)",
						"    if err != nil {",
						"        return nil, err",
						"    }",
						"    defer rows.Close()",
						"    var out []Order",
						"    for rows.Next() {",
						"        var o Order",
						"        if err := rows.Scan(&o.ID, &o.Total); err != nil {",
						"            return nil, err",
						"        }",
						"        out = append(out, o)",
						"    }",
						"    return out, nil",
						"}",
					].join("\n"),
					annotations: [
						{
							line: 142,
							kind: "critical",
							text: "**Outbox write is outside the transaction.** On retry, you can get duplicate emissions with different `event_id`s. Move the `Emit` inside the `tx` and commit together.",
						},
						{
							line: 148,
							kind: "warning",
							text: "Swallowing the error here means the order is committed but downstream never hears about it. At minimum, bubble this up — even if you don't fail the request.",
						},
						{
							line: 154,
							kind: "critical",
							text: "Hard-coded `context.Background()` discards the caller's context. Use `ctx` and accept it as a parameter.",
						},
					],
				},
			},
		},

		{
			kind: "markdown",
			markdown: "## Proposed fix\n\nHere is the minimum-diff version that resolves both critical items:",
		},

		{
			kind: "block",
			block: {
				type: "code",
				data: {
					id: "code-outbox",
					title: "server/checkout/outbox.go",
					file: "server/checkout/outbox.go",
					lang: "go",
					startLine: 58,
					source: [
						"func (o *Outbox) fetchPending(ctx context.Context) ([]Event, error) {",
						"    var out []Event",
						"    rows, err := o.db.QueryContext(ctx,",
						"        `SELECT id, payload, created_at",
						"         FROM outbox WHERE published_at IS NULL",
						"         ORDER BY id`)",
						"    if err != nil {",
						"        return nil, err",
						"    }",
						"    defer rows.Close()",
						"    for rows.Next() { /* ...scan... */ }",
						"    return out, nil",
						"}",
					].join("\n"),
					annotations: [
						{
							line: 64,
							kind: "warning",
							text: "No `LIMIT` clause. On backlog this loads thousands of rows into memory. Add `LIMIT 200` and use the last id as a cursor for the next page.",
						},
					],
				},
			},
		},

		{
			kind: "block",
			block: {
				type: "diff",
				data: {
					id: "diff-fix",
					title: "Suggested patch — server/checkout/order_service.go",
					file: "server/checkout/order_service.go",
					lang: "go",
					mode: "split",
					from: [
						"    order, err := s.insertOrder(ctx, tx, req)",
						"    if err != nil {",
						"        return nil, err",
						"    }",
						"",
						"    if err := tx.Commit(); err != nil {",
						'        return nil, fmt.Errorf("commit: %w", err)',
						"    }",
						"",
						"    if err := s.outbox.Emit(ctx, OrderPlaced{ID: order.ID}); err != nil {",
						'        log.Warnf("outbox emit failed: %v", err)',
						"    }",
					].join("\n"),
					to: [
						"    order, err := s.insertOrder(ctx, tx, req)",
						"    if err != nil {",
						"        return nil, err",
						"    }",
						"",
						"    if err := s.outbox.EmitTx(ctx, tx, OrderPlaced{ID: order.ID}); err != nil {",
						'        return nil, fmt.Errorf("outbox: %w", err)',
						"    }",
						"",
						"    if err := tx.Commit(); err != nil {",
						'        return nil, fmt.Errorf("commit: %w", err)',
						"    }",
					].join("\n"),
				},
			},
		},

		{
			kind: "block",
			block: {
				type: "checklist",
				data: {
					id: "rubric",
					title: "Quality gate",
					items: [
						{ label: "All tests pass on CI", status: "pass" },
						{ label: "Coverage ≥ 80% on touched packages", status: "pass", note: "checkout: 84.2%" },
						{ label: "No new `context.Background()` in hot paths", status: "fail", note: "order_service.go:154" },
						{ label: "Migrations are backwards-compatible", status: "pass" },
						{ label: "Public API kept stable", status: "pass" },
						{ label: "Outbox table has retention policy", status: "skip", note: "tracked in #491" },
						{ label: "Mobile client tested", status: "na", note: "server-only change" },
						{ label: "Docs updated", status: "pass" },
					],
				},
			},
		},

		{
			kind: "block",
			block: {
				type: "tabs",
				data: {
					id: "tabs-impl",
					title: "Outbox poller — implementations considered",
					tabs: [
						{
							label: "Polling (chosen)",
							content:
								"Selected for simplicity. Single goroutine polls every `250ms`, batches up to 200 events, advances cursor. Easy to reason about; tolerates DB restarts.",
						},
						{
							label: "Logical replication",
							content:
								"Rejected for MVP — requires Postgres role grants we don't have in all environments. Revisit in Q3 once infra catches up.",
						},
						{
							label: "Trigger + NOTIFY",
							content:
								"Rejected — `NOTIFY` payloads are limited to 8KB and we'd need a per-shard listener. Adds operational surface without clear win.",
						},
					],
				},
			},
		},

		{
			kind: "markdown",
			markdown:
				"## System view\n\nThe new architecture, with the outbox table sitting between the order service and downstream consumers:",
		},

		{
			kind: "block",
			block: {
				type: "graph",
				data: {
					id: "graph-arch",
					title: "Order pipeline after this PR",
					direction: "LR",
					nodes: [
						{ id: "client", label: "Web / Mobile", group: "ext" },
						{ id: "api", label: "checkout-api", group: "api" },
						{ id: "svc", label: "OrderService", group: "svc" },
						{ id: "db", label: "orders (Postgres)", group: "db" },
						{ id: "outbox", label: "outbox table", group: "db" },
						{ id: "poller", label: "outbox-poller", group: "svc" },
						{ id: "bus", label: "events (NATS)", group: "ext" },
						{ id: "fulfil", label: "fulfilment", group: "ext" },
						{ id: "ledger", label: "ledger", group: "ext" },
					],
					edges: [
						{ from: "client", to: "api", label: "POST /orders" },
						{ from: "api", to: "svc", label: "" },
						{ from: "svc", to: "db", label: "INSERT" },
						{ from: "svc", to: "outbox", label: "EmitTx" },
						{ from: "poller", to: "outbox", label: "fetch" },
						{ from: "poller", to: "bus", label: "publish" },
						{ from: "bus", to: "fulfil", label: "", style: "dashed" },
						{ from: "bus", to: "ledger", label: "", style: "dashed" },
					],
				},
			},
		},

		{
			kind: "block",
			block: {
				type: "mermaid",
				data: {
					id: "mm-flow",
					title: "Place-order sequence (rendered from `clv:mermaid`)",
					source:
						"sequenceDiagram\n    Client->>API: POST /orders\n    API->>OrderService: PlaceOrder(req)\n    OrderService->>DB: BEGIN, INSERT order, INSERT outbox, COMMIT\n    OrderService-->>API: Order\n    Note over Poller,DB: Poller fetches every 250ms\n    Poller->>DB: SELECT … FROM outbox LIMIT 200\n    Poller->>Bus: publish OrderPlaced",
				},
			},
		},

		{
			kind: "block",
			block: {
				type: "chart",
				data: {
					id: "chart-latency",
					title: "Synthetic benchmark — checkout latency by percentile",
					type: "line",
					xKey: "load",
					yKeys: ["before_p50", "before_p95", "after_p50", "after_p95"],
					height: 240,
					data: [
						{ load: "10 rps", before_p50: 31, before_p95: 92, after_p50: 24, after_p95: 71 },
						{ load: "50 rps", before_p50: 38, before_p95: 118, after_p50: 26, after_p95: 84 },
						{ load: "100 rps", before_p50: 52, before_p95: 145, after_p50: 33, after_p95: 102 },
						{ load: "200 rps", before_p50: 78, before_p95: 190, after_p50: 45, after_p95: 118 },
						{ load: "400 rps", before_p50: 142, before_p95: 312, after_p50: 81, after_p95: 184 },
						{ load: "600 rps", before_p50: 228, before_p95: 470, after_p50: 122, after_p95: 246 },
					],
				},
			},
		},

		{
			kind: "block",
			block: {
				type: "table",
				data: {
					id: "tbl-bench",
					title: "Per-endpoint benchmark (400 rps, 60 s)",
					columns: [
						{ key: "endpoint", label: "Endpoint", align: "left", sortable: true },
						{ key: "p50", label: "p50 (ms)", align: "right", sortable: true },
						{ key: "p95", label: "p95 (ms)", align: "right", sortable: true },
						{ key: "err", label: "Errors", align: "right", sortable: true },
						{ key: "verdict", label: "Verdict", align: "center" },
					],
					rows: [
						{ endpoint: "POST /orders", p50: 45, p95: 118, err: "0.00%", verdict: "pass" },
						{ endpoint: "GET  /orders/:id", p50: 8, p95: 22, err: "0.00%", verdict: "pass" },
						{ endpoint: "GET  /orders", p50: 110, p95: 414, err: "0.12%", verdict: "warn" },
						{ endpoint: "POST /orders/refund", p50: 62, p95: 148, err: "0.00%", verdict: "pass" },
						{ endpoint: "POST /webhooks/replay", p50: 38, p95: 96, err: "0.00%", verdict: "pass" },
					],
				},
			},
		},

		{
			kind: "block",
			block: {
				type: "timeline",
				data: {
					id: "timeline-roll",
					title: "Suggested rollout",
					events: [
						{
							at: "step 1",
							title: "Land patch behind feature flag",
							body: "Flag: `checkout.outbox.enabled`. Off in prod by default.",
							kind: "info",
						},
						{
							at: "step 2",
							title: "Backfill outbox table",
							body: "Run `migrations/0014` + idempotent backfill job overnight.",
							kind: "info",
						},
						{
							at: "step 3",
							title: "Enable on internal traffic (1%)",
							body: "Watch p95 and error rate dashboards for 24h.",
							kind: "tip",
						},
						{
							at: "step 4",
							title: "Ramp to 10% → 50% → 100%",
							body: "Each step held for 4h. Alarms hooked to PagerDuty.",
							kind: "warning",
						},
						{
							at: "step 5",
							title: "Delete legacy emitter path",
							body: "Drop `legacy_emitter.go` and remove build tags.",
							kind: "danger",
						},
					],
				},
			},
		},

		{
			kind: "block",
			block: {
				type: "steps",
				data: {
					id: "steps-refactor",
					title: "Walkthrough — how the outbox write moves",
					initial: 0,
					steps: [
						{
							title: "Today — emit after commit",
							body: "Current code emits to the outbox **after** the transaction commits. A retry on the wire causes duplicate emission.",
							block: {
								type: "code",
								data: {
									id: "code-step-today",
									lang: "go",
									startLine: 1,
									source: [
										"if err := tx.Commit(); err != nil {",
										"    return nil, err",
										"}",
										"s.outbox.Emit(ctx, OrderPlaced{ID: order.ID}) // ⚠ outside tx",
									].join("\n"),
									annotations: [
										{
											line: 4,
											kind: "critical",
											text: "Emitting outside the committed transaction is the root cause — see the walkthrough below.",
										},
									],
								},
							},
						},
						{
							title: "Step 1 — accept the tx in EmitTx",
							body: "Add a sibling method that takes the active transaction so the outbox row can be written atomically.",
							block: {
								type: "code",
								data: {
									lang: "go",
									source: [
										"func (o *Outbox) EmitTx(ctx context.Context, tx *sql.Tx, e Event) error {",
										"    _, err := tx.ExecContext(ctx, `INSERT INTO outbox …`, e)",
										"    return err",
										"}",
									].join("\n"),
								},
							},
						},
						{
							title: "Step 2 — call EmitTx before commit",
							body: "Reorder so both inserts share the transaction. If either fails the whole thing rolls back.",
							block: {
								type: "code",
								data: {
									lang: "go",
									source: [
										"if err := s.outbox.EmitTx(ctx, tx, OrderPlaced{ID: order.ID}); err != nil {",
										'    return nil, fmt.Errorf("outbox: %w", err)',
										"}",
										"if err := tx.Commit(); err != nil {",
										'    return nil, fmt.Errorf("commit: %w", err)',
										"}",
									].join("\n"),
								},
							},
						},
						{
							title: "Done — exactly-once at the boundary",
							body: "The poller delivers at-least-once downstream, but the order row and the outbox row are now committed atomically.",
						},
					],
				},
			},
		},

		{
			kind: "block",
			block: {
				type: "callout",
				data: {
					id: "wrap",
					title: "Overall",
					kind: "tip",
					body: "Once the two critical items are fixed, this is ready. The benchmark numbers are real — please re-run after the patch to confirm we haven't regressed.",
				},
			},
		},

		{
			kind: "fallback",
			blockType: "clv:capacity-plan",
			raw: '```clv:capacity-plan\n{ "horizon_days": 30, "growth": "12%" }\n```',
			error: 'Unknown block type "capacity-plan". Falling back to raw render. Add a renderer to support this block.',
		},
	],
};
