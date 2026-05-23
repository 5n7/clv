import { describe, expect, test } from "bun:test";

import { blockSchema, documentSchema } from "./schema";

describe("blockSchema — accepts representative valid blocks (SPEC §7)", () => {
	const validBlocks: unknown[] = [
		{ type: "callout", data: { kind: "danger", body: "blocking", title: "Heads up" } },
		{
			type: "code",
			data: {
				id: "code-1",
				lang: "go",
				file: "main.go",
				startLine: 10,
				source: "func main() {}",
				annotations: [{ line: 11, kind: "critical", text: "note" }],
			},
		},
		{ type: "diff", data: { lang: "go", mode: "split", from: "a", to: "b" } },
		{ type: "tree", data: { nodes: [{ path: "a.go", status: "modified", note: "n", href: "#x" }] } },
		{
			type: "findings",
			data: { items: [{ severity: "critical", title: "bug", line: 1, blockId: "code-1" }] },
		},
		{ type: "checklist", data: { items: [{ label: "tests", status: "pass", note: "ok" }] } },
		{
			type: "metrics",
			data: { columns: 4, items: [{ label: "LOC", value: "+486", delta: "+3", trend: "up" }] },
		},
		{
			type: "chart",
			data: {
				type: "line",
				xKey: "load",
				yKeys: ["p50", "p95"],
				height: 240,
				data: [{ load: "10 rps", p50: 31, p95: 92 }],
			},
		},
		{
			type: "table",
			data: {
				columns: [{ key: "k", label: "K", align: "right", sortable: true }],
				rows: [{ k: 1 }],
				caption: "cap",
			},
		},
		{
			type: "graph",
			data: {
				direction: "LR",
				nodes: [{ id: "a", label: "A", group: "g" }],
				edges: [{ from: "a", to: "a", label: "self", style: "dashed" }],
			},
		},
		{ type: "timeline", data: { events: [{ at: "t1", title: "e", kind: "info" }] } },
		{ type: "mermaid", data: { source: "graph TD; A-->B" } },
		{
			type: "tabs",
			data: {
				tabs: [
					{ label: "chosen", content: "text" },
					{ label: "nested", block: { type: "callout", data: { kind: "tip", body: "x" } } },
				],
			},
		},
		{
			type: "steps",
			data: {
				initial: 0,
				steps: [
					{ title: "s1", body: "do", block: { type: "code", data: { lang: "go", source: "x()" } } },
					{ title: "s2", body: "done" },
				],
			},
		},
	];

	for (const block of validBlocks) {
		const type = (block as { type: string }).type;
		test(`accepts a valid ${type} block`, () => {
			const res = blockSchema.safeParse(block);
			expect(res.success).toBe(true);
		});
	}
});

describe("blockSchema — rejects clearly-invalid payloads", () => {
	test("rejects callout missing required body", () => {
		const res = blockSchema.safeParse({ type: "callout", data: { kind: "info" } });
		expect(res.success).toBe(false);
	});

	test("rejects callout with a wrong enum value for kind", () => {
		const res = blockSchema.safeParse({ type: "callout", data: { kind: "nope", body: "x" } });
		expect(res.success).toBe(false);
	});

	test("rejects code missing required source", () => {
		const res = blockSchema.safeParse({ type: "code", data: { lang: "go" } });
		expect(res.success).toBe(false);
	});

	test("rejects an unknown block type", () => {
		const res = blockSchema.safeParse({ type: "capacity-plan", data: {} });
		expect(res.success).toBe(false);
	});

	test("rejects checklist with a wrong status enum value", () => {
		const res = blockSchema.safeParse({
			type: "checklist",
			data: { items: [{ label: "x", status: "maybe" }] },
		});
		expect(res.success).toBe(false);
	});
});

describe("treeNodeSchema — restricts href to safe schemes (security)", () => {
	test("rejects javascript: href; accepts http(s) and anchor", () => {
		const bad = blockSchema.safeParse({
			type: "tree",
			data: { nodes: [{ path: "a.go", href: "javascript:alert(1)" }] },
		});
		expect(bad.success).toBe(false);
		const https = blockSchema.safeParse({
			type: "tree",
			data: { nodes: [{ path: "a.go", href: "https://example.com" }] },
		});
		expect(https.success).toBe(true);
		const anchor = blockSchema.safeParse({
			type: "tree",
			data: { nodes: [{ path: "a.go", href: "#anchor" }] },
		});
		expect(anchor.success).toBe(true);
	});

	test("rejects protocol-relative href (//...)", () => {
		const rel = blockSchema.safeParse({
			type: "tree",
			data: { nodes: [{ path: "a.go", href: "//evil.com" }] },
		});
		expect(rel.success).toBe(false);
	});

	test("accepts single-slash relative href", () => {
		const local = blockSchema.safeParse({
			type: "tree",
			data: { nodes: [{ path: "a.go", href: "/local/path" }] },
		});
		expect(local.success).toBe(true);
	});
});

describe("documentSchema — accepts and rejects Document shapes (SPEC §8.2)", () => {
	test("accepts a minimal valid document", () => {
		const res = documentSchema.safeParse({
			title: "PR",
			theme: "auto",
			nodes: [
				{ kind: "markdown", markdown: "## Summary" },
				{ kind: "block", block: { type: "callout", data: { kind: "tip", body: "x" } } },
				{ kind: "fallback", blockType: "clv:foo", raw: "```clv:foo\n{}\n```", error: "Unknown" },
			],
		});
		expect(res.success).toBe(true);
	});

	test("accepts optional source/generated/subtitle", () => {
		const res = documentSchema.safeParse({
			title: "PR",
			theme: "dark",
			source: "review.md",
			generated: "2026-05-20",
			subtitle: "reviewed by Claude Code",
			nodes: [],
		});
		expect(res.success).toBe(true);
	});

	test("rejects a document with an invalid theme enum", () => {
		const res = documentSchema.safeParse({ title: "PR", theme: "neon", nodes: [] });
		expect(res.success).toBe(false);
	});

	test("rejects a document missing the required title", () => {
		const res = documentSchema.safeParse({ theme: "auto", nodes: [] });
		expect(res.success).toBe(false);
	});
});
