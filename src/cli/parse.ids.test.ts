import type { DocNode } from "@shared/types";
import { describe, expect, test } from "bun:test";

import { parseDocument, type ParseOptions } from "./parse";

const OPTS: ParseOptions = {
	title: "Test",
	theme: "auto",
	source: "test.md",
};

function parse(input: string) {
	return parseDocument(input, OPTS);
}

// Build a fenced clv block from a type/header/JSON body.
function fence(header: string, body: string): string {
	return "```" + header + "\n" + body + "\n```";
}

// Resolve a node's stable id regardless of kind (block carries it at
// block.data.id; markdown/fallback carry it at node.id).
function idOf(node: DocNode): string | undefined {
	return node.kind === "block" ? node.block.data.id : node.id;
}

describe("parseDocument — stable per-node ids (Phase 0)", () => {
	test("every node has a resolvable, prefixed id", () => {
		const input = [
			"# Intro paragraph.",
			"",
			fence("clv:code", `{ "lang": "ts", "source": "const a = 1;" }`),
			"",
			"Outro paragraph.",
			"",
			fence("clv:unknown-type", `{}`),
		].join("\n");
		const { doc } = parse(input);

		expect(doc.nodes.map((n) => n.kind)).toEqual(["markdown", "block", "markdown", "fallback"]);
		for (const node of doc.nodes) {
			const id = idOf(node);
			expect(typeof id).toBe("string");
			expect(id!.length).toBeGreaterThan(0);
		}
		expect(idOf(doc.nodes[0]!)).toMatch(/^md-/);
		expect(idOf(doc.nodes[1]!)).toMatch(/^block-/);
		expect(idOf(doc.nodes[2]!)).toMatch(/^md-/);
		expect(idOf(doc.nodes[3]!)).toMatch(/^fb-/);
	});

	test("parsing the same input twice yields identical ids (determinism)", () => {
		const input = [
			"Some prose.",
			"",
			fence("clv:code", `{ "lang": "ts", "source": "x();" }`),
			"",
			"More prose.",
			"",
			fence("clv:unknown-type", `{ "a": 1 }`),
		].join("\n");

		const a = parse(input).doc.nodes.map(idOf);
		const b = parse(input).doc.nodes.map(idOf);
		expect(a).toEqual(b);
	});

	test("editing the middle node leaves the first/last node ids unchanged (content-based)", () => {
		const make = (mid: string) =>
			[
				"First paragraph.",
				"",
				fence("clv:callout", JSON.stringify({ kind: "info", body: mid })),
				"",
				"Last paragraph.",
			].join("\n");

		const before = parse(make("original body")).doc.nodes;
		const after = parse(make("edited body")).doc.nodes;

		// First and last (markdown) ids are unchanged…
		expect(idOf(before[0]!)).toBe(idOf(after[0]!));
		expect(idOf(before[2]!)).toBe(idOf(after[2]!));
	});

	test("two markdown nodes with identical content get distinct (de-duped) ids", () => {
		const input = [
			"Same text.",
			"",
			fence("clv:callout", `{ "kind": "info", "body": "divider" }`),
			"",
			"Same text.",
		].join("\n");
		const { doc } = parse(input);

		const mdIds = doc.nodes.filter((n) => n.kind === "markdown").map((n) => idOf(n));
		expect(mdIds).toHaveLength(2);
		expect(mdIds[0]).toMatch(/^md-/);
		expect(mdIds[0]).not.toBe(mdIds[1]);
		expect(mdIds[1]).toBe(`${mdIds[0]}-2`);
	});

	test("two fallback nodes with identical content get distinct (de-duped) ids", () => {
		const f = fence("clv:unknown-type", `{ "a": 1 }`);
		const { doc } = parse([f, "", f].join("\n"));

		const fbIds = doc.nodes.filter((n) => n.kind === "fallback").map((n) => idOf(n));
		expect(fbIds).toHaveLength(2);
		expect(fbIds[0]).toMatch(/^fb-/);
		expect(fbIds[1]).toBe(`${fbIds[0]}-2`);
	});
});

describe("parseDocument — node-level ids on every DocNode (incl. non-code blocks)", () => {
	const NON_CODE_BLOCK = fence("clv:callout", `{ "kind": "info", "body": "heads up" }`);
	const METRICS_BLOCK = fence("clv:metrics", JSON.stringify({ items: [{ label: "Coverage", value: "92%" }] }));

	test("EVERY node — markdown, non-code block, code block, fallback — has a node-level id", () => {
		const input = [
			"Intro.",
			"",
			NON_CODE_BLOCK,
			"",
			METRICS_BLOCK,
			"",
			fence("clv:code", `{ "lang": "ts", "source": "const a = 1;" }`),
			"",
			fence("clv:unknown-type", `{}`),
		].join("\n");
		const { doc } = parse(input);

		expect(doc.nodes.map((n) => n.kind)).toEqual(["markdown", "block", "block", "block", "fallback"]);
		for (const node of doc.nodes) {
			expect(typeof node.id).toBe("string");
			expect(node.id!.length).toBeGreaterThan(0);
		}
		// Non-code block nodes get the `blk-` prefix; their block.data.id stays unset
		// so the static TOC anchor logic (which keys off block.data.id) is unchanged.
		const callout = doc.nodes[1]!;
		const metrics = doc.nodes[2]!;
		expect(callout.id).toMatch(/^blk-/);
		expect(metrics.id).toMatch(/^blk-/);
		expect(callout.kind === "block" && callout.block.data.id).toBeUndefined();
		expect(metrics.kind === "block" && metrics.block.data.id).toBeUndefined();
	});

	test("a non-code block node's id is stable/deterministic across re-parse", () => {
		const input = ["Intro.", "", NON_CODE_BLOCK].join("\n");
		const a = parse(input).doc.nodes.map((n) => n.id);
		const b = parse(input).doc.nodes.map((n) => n.id);
		expect(a).toEqual(b);
		expect(a[1]).toMatch(/^blk-/);
	});

	test("a code block node reuses block.data.id (node.id === block.data.id, not a separate blk- id)", () => {
		const input = fence("clv:code", `{ "lang": "ts", "source": "x();" }`);
		const node = parse(input).doc.nodes[0]!;
		expect(node.kind).toBe("block");
		if (node.kind !== "block") throw new Error("expected block node");
		expect(node.id).toBe(node.block.data.id);
		expect(node.id).toMatch(/^block-/);
	});

	test("inserting a markdown paragraph above a block node does NOT change that block node's id", () => {
		const without = parse(NON_CODE_BLOCK).doc.nodes;
		const withMd = parse(["A new paragraph above.", "", NON_CODE_BLOCK].join("\n")).doc.nodes;

		const calloutWithout = without.find((n) => n.kind === "block")!;
		const calloutWith = withMd.find((n) => n.kind === "block")!;
		expect(calloutWith.id).toBe(calloutWithout.id);
		expect(calloutWith.id).toMatch(/^blk-/);
	});

	test("two non-code blocks with the SAME author-supplied data.id get DISTINCT node.ids (deduped) while data.id stays authored", () => {
		const input = [
			fence("clv:callout", JSON.stringify({ kind: "info", body: "first", id: "shared-id" })),
			"",
			fence("clv:callout", JSON.stringify({ kind: "info", body: "second", id: "shared-id" })),
		].join("\n");
		const { doc } = parse(input);
		const blocks = doc.nodes.filter((n) => n.kind === "block");
		expect(blocks).toHaveLength(2);
		const [a, b] = blocks;
		if (a?.kind !== "block" || b?.kind !== "block") throw new Error("expected two block nodes");
		// node.id (the React key) is deduped: the second collides and gets `-2`.
		expect(a.id).toBe("shared-id");
		expect(b.id).toBe("shared-id-2");
		expect(a.id).not.toBe(b.id);
		// block.data.id (findings anchors / TOC) stays as authored on BOTH.
		expect(a.block.data.id).toBe("shared-id");
		expect(b.block.data.id).toBe("shared-id");
	});

	test("two code blocks with the SAME explicit data.id get DISTINCT node.ids (deduped) while data.id stays authored", () => {
		const input = [
			fence("clv:code", JSON.stringify({ lang: "ts", source: "a();", id: "dup" })),
			"",
			fence("clv:code", JSON.stringify({ lang: "ts", source: "b();", id: "dup" })),
		].join("\n");
		const { doc } = parse(input);
		const blocks = doc.nodes.filter((n) => n.kind === "block");
		expect(blocks).toHaveLength(2);
		const [a, b] = blocks;
		if (a?.kind !== "block" || b?.kind !== "block") throw new Error("expected two block nodes");
		// node.id (the React key) is deduped: the second collides and gets `-2`.
		expect(a.id).toBe("dup");
		expect(b.id).toBe("dup-2");
		expect(a.id).not.toBe(b.id);
		// block.data.id (findings anchors / TOC) stays as authored on BOTH.
		expect(a.block.data.id).toBe("dup");
		expect(b.block.data.id).toBe("dup");
	});

	test("a single author-supplied data.id is unchanged (common case): node.id === data.id", () => {
		const input = fence("clv:callout", JSON.stringify({ kind: "info", body: "solo", id: "only-id" }));
		const node = parse(input).doc.nodes[0]!;
		if (node.kind !== "block") throw new Error("expected block node");
		expect(node.id).toBe("only-id");
		expect(node.block.data.id).toBe("only-id");
	});
});
