import type { Block, Code } from "@shared/types";
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { CODE_BLOCK_ID_HASH_HEX_LEN, parseDocument, type ParseOptions } from "./parse";

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

describe("parseDocument — fence header attr + JSON body merge (SPEC §6.1)", () => {
	test("merges header title= into the JSON body", () => {
		const { doc } = parse(fence(`clv:callout title="From header"`, `{ "kind": "info", "body": "hi" }`));
		const node = doc.nodes[0]!;
		expect(node.kind).toBe("block");
		if (node.kind !== "block") throw new Error("expected block");
		expect(node.block.type).toBe("callout");
		const data = node.block.data as { title?: string; kind: string; body: string };
		expect(data.title).toBe("From header");
		expect(data.kind).toBe("info");
		expect(data.body).toBe("hi");
	});

	test("JSON body wins on key conflict with header attr", () => {
		const { doc } = parse(
			fence(`clv:callout title="header wins?"`, `{ "title": "body wins", "kind": "tip", "body": "x" }`),
		);
		const node = doc.nodes[0]!;
		if (node.kind !== "block") throw new Error("expected block");
		const data = node.block.data as { title?: string };
		expect(data.title).toBe("body wins");
	});
});

describe("parseDocument — fallbacks (SPEC §6.3, §10)", () => {
	test("invalid JSON body → fallback node, and valid blocks still parse", () => {
		const input = [
			fence("clv:callout", `{ this is not valid json }`),
			"",
			fence("clv:callout", `{ "kind": "info", "body": "ok" }`),
		].join("\n");
		const { doc, hadError } = parse(input);

		expect(hadError).toBe(true);
		const first = doc.nodes[0]!;
		expect(first.kind).toBe("fallback");
		if (first.kind !== "fallback") throw new Error("expected fallback");
		expect(first.blockType).toBe("clv:callout");
		expect(first.error).toContain("Invalid JSON");

		const second = doc.nodes[1]!;
		expect(second.kind).toBe("block");
	});

	test("unknown clv:<type> → fallback (before JSON/schema work)", () => {
		const { doc, hadError } = parse(fence("clv:capacity-plan", `{ "horizon_days": 30 }`));
		expect(hadError).toBe(true);
		const node = doc.nodes[0]!;
		expect(node.kind).toBe("fallback");
		if (node.kind !== "fallback") throw new Error("expected fallback");
		expect(node.blockType).toBe("clv:capacity-plan");
		expect(node.error).toContain("Unknown block type");
	});

	test("schema-violating block (callout kind: 123) → fallback", () => {
		const { doc, hadError } = parse(fence("clv:callout", `{ "kind": 123, "body": "x" }`));
		expect(hadError).toBe(true);
		const node = doc.nodes[0]!;
		expect(node.kind).toBe("fallback");
		if (node.kind !== "fallback") throw new Error("expected fallback");
		expect(node.error).toContain("Schema violation");
	});
});

describe("parseDocument — mermaid + markdown coalescing (SPEC §7.12, §8)", () => {
	test('bare ```mermaid``` fence → { type: "mermaid", data: { source } }', () => {
		const source = "graph TD\n  A-->B";
		const { doc, hadError } = parse("```mermaid\n" + source + "\n```");
		expect(hadError).toBe(false);
		const node = doc.nodes[0]!;
		if (node.kind !== "block") throw new Error("expected block");
		expect(node.block.type).toBe("mermaid");
		const data = node.block.data as { source: string };
		expect(data.source).toBe(source);
	});

	test("consecutive plain-markdown tokens coalesce into a single markdown node", () => {
		const { doc } = parse("# H1\n\nA paragraph.\n\n## H2\n\nMore text.");
		const mdNodes = doc.nodes.filter((n) => n.kind === "markdown");
		expect(doc.nodes.length).toBe(1);
		expect(mdNodes.length).toBe(1);
		const node = doc.nodes[0]!;
		if (node.kind !== "markdown") throw new Error("expected markdown");
		expect(node.markdown).toContain("# H1");
		expect(node.markdown).toContain("A paragraph.");
		expect(node.markdown).toContain("## H2");
		expect(node.markdown).toContain("More text.");
	});

	test("a clv fence splits the surrounding markdown into separate nodes", () => {
		const input = [
			"Intro paragraph.",
			"",
			fence("clv:callout", `{ "kind": "info", "body": "mid" }`),
			"",
			"Outro paragraph.",
		].join("\n");
		const { doc } = parse(input);
		expect(doc.nodes.map((n) => n.kind)).toEqual(["markdown", "block", "markdown"]);
	});
});

describe("parseDocument — auto-id assignment (SPEC §8.3)", () => {
	const idPattern = new RegExp(`^block-[0-9a-f]{${CODE_BLOCK_ID_HASH_HEX_LEN}}$`);

	const expectedId = (data: Code) =>
		"block-" +
		createHash("sha1")
			.update(`${data.file ?? ""}\n${data.startLine ?? ""}\n${data.source}`)
			.digest("hex")
			.slice(0, CODE_BLOCK_ID_HASH_HEX_LEN);

	test("a clv:code block without id gets a block-<hash> id", () => {
		const source = "const a = 1;";
		const { doc } = parse(fence("clv:code", `{ "lang": "ts", "source": "${source}" }`));
		const node = doc.nodes[0]!;
		if (node.kind !== "block" || node.block.type !== "code") throw new Error("expected code block");
		expect(node.block.data.id).toMatch(idPattern);
		expect(node.block.data.id).toBe(expectedId(node.block.data));
	});

	test("a findings item's blockId can reference the auto-id of a code block", () => {
		const source = "x();";
		const { doc } = parse(fence("clv:code", `{ "lang": "ts", "source": "${source}" }`));
		const node = doc.nodes[0]!;
		if (node.kind !== "block" || node.block.type !== "code") throw new Error("expected code block");
		const autoId = node.block.data.id!;

		// A findings block can carry a matching blockId (anchor resolves to autoId).
		const findingsInput = fence(
			"clv:findings",
			JSON.stringify({ items: [{ severity: "info", title: "see code", blockId: autoId }] }),
		);
		const fres = parse(findingsInput);
		const fnode = fres.doc.nodes[0]!;
		if (fnode.kind !== "block" || fnode.block.type !== "findings") throw new Error("expected findings");
		expect(fnode.block.data.items[0]!.blockId).toBe(autoId);
	});

	test("a code block nested inside clv:steps also gets an auto-id (recursive walk)", () => {
		const body = JSON.stringify({
			steps: [
				{
					title: "step",
					block: { type: "code", data: { lang: "go", source: "fmt.Println()" } },
				},
			],
		});
		const { doc } = parse(fence("clv:steps", body));
		const node = doc.nodes[0]!;
		if (node.kind !== "block" || node.block.type !== "steps") throw new Error("expected steps");
		const nested = node.block.data.steps[0]!.block as Extract<Block, { type: "code" }>;
		expect(nested.data.id).toMatch(idPattern);
	});

	test("a code block nested inside clv:tabs also gets an auto-id (recursive walk)", () => {
		const body = JSON.stringify({
			tabs: [
				{
					label: "tab",
					block: { type: "code", data: { lang: "go", source: "println()" } },
				},
			],
		});
		const { doc } = parse(fence("clv:tabs", body));
		const node = doc.nodes[0]!;
		if (node.kind !== "block" || node.block.type !== "tabs") throw new Error("expected tabs");
		const nested = node.block.data.tabs[0]!.block as Extract<Block, { type: "code" }>;
		expect(nested.data.id).toMatch(idPattern);
	});

	test("a clv:code block WITH an explicit id keeps it", () => {
		const { doc } = parse(fence("clv:code", `{ "id": "my-id", "lang": "ts", "source": "y();" }`));
		const node = doc.nodes[0]!;
		if (node.kind !== "block" || node.block.type !== "code") throw new Error("expected code block");
		expect(node.block.data.id).toBe("my-id");
	});

	test("duplicate code blocks (same file/source) get distinct auto-ids", () => {
		const body = `{ "lang": "ts", "source": "same();" }`;
		const input = [fence("clv:code", body), "", fence("clv:code", body)].join("\n");
		const { doc } = parse(input);
		const ids = doc.nodes
			.filter((n) => n.kind === "block" && n.block.type === "code")
			.map((n) => (n as Extract<typeof n, { kind: "block" }>).block.data.id);
		expect(ids).toHaveLength(2);
		expect(ids[0]).toMatch(idPattern);
		expect(ids[0]).not.toBe(ids[1]);
		expect(ids[1]).toBe(`${ids[0]}-2`);
	});
});

describe("parseDocument — hadError semantics (--strict plumbing)", () => {
	test("hadError is false for an all-valid document", () => {
		const input = ["# Title", "", fence("clv:callout", `{ "kind": "info", "body": "ok" }`)].join("\n");
		const { hadError } = parse(input);
		expect(hadError).toBe(false);
	});

	test("hadError is true when any fallback is produced", () => {
		const { hadError } = parse(fence("clv:unknown-type", `{}`));
		expect(hadError).toBe(true);
	});

	test("the document carries the supplied title/theme/source", () => {
		const { doc } = parse("# H");
		expect(doc.title).toBe(OPTS.title);
		expect(doc.theme).toBe(OPTS.theme);
		expect(doc.source).toBe(OPTS.source);
		expect(typeof doc.generated).toBe("string");
	});
});
