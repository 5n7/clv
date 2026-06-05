import { blockDataSchemas } from "@shared/schema";
import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { extractBlockSection, renderDoc, runDoc } from "./doc";
import { parseDocument } from "./parse";

// The two source documents are read FROM DISK (not the text-import) so these
// tests verify the files that actually ship, independent of the build-time
// inlining in doc.ts. Bun's CWD for tests is the project root, so the relative
// paths resolve against the worktree root.
const styleDoc = await Bun.file("docs/output-style-clv.md").text();
const showcaseOnDisk = await Bun.file("examples/showcase.clv.md").text();

// All valid block names, in their canonical (schema) order.
const blockNames = Object.keys(blockDataSchemas);

// Pull the JSON body of the FIRST ` ```clv:<type> ` fence out of a section.
// Anchors on EXACTLY three backticks at line start (a 4-backtick outer markdown
// fence would not match) followed by `clv:<type>` and the rest of the info line,
// then captures everything up to the closing ``` line.
function firstClvFenceBody(section: string, type: string): string | null {
	const re = new RegExp("^```clv:" + type + "[^\\n]*\\n([\\s\\S]*?)\\n```", "m");
	const m = section.match(re);
	return m ? (m[1] ?? null) : null;
}

describe("doc — per-block example validity (the critical test)", () => {
	// For every block type the CLI knows about, `clv doc <type>` extracts the
	// section from the shipped style doc and shows a worked ` ```clv:<type> `
	// example. That example's JSON body MUST validate against the block's schema —
	// otherwise the CLI teaches a format the parser would reject.
	test.each(blockNames)("clv:%s example body validates against its schema", (type) => {
		const section = extractBlockSection(styleDoc, type);
		expect(section).not.toBeNull();

		const body = firstClvFenceBody(section as string, type);
		expect(body, `no \`\`\`clv:${type} example fence found in its section`).not.toBeNull();

		let parsed: unknown;
		expect(() => {
			parsed = JSON.parse(body as string);
		}, `clv:${type} example body is not valid JSON`).not.toThrow();

		const result = blockDataSchemas[type as keyof typeof blockDataSchemas].safeParse(parsed);
		// Surface the zod error in the failure message if it does not validate.
		expect(result.success, result.success ? "" : JSON.stringify(result.error?.issues)).toBe(true);
	});
});

describe("extractBlockSection — precision and boundaries", () => {
	test("a section does not bleed into adjacent sections (exactly one clv: header)", () => {
		const section = extractBlockSection(styleDoc, "code");
		expect(section).not.toBeNull();
		// The returned section must contain its own header and NO other `### clv:`.
		expect(section).toContain("### `clv:code`");
		const headerCount = (section as string).match(/^### `clv:/gm)?.length ?? 0;
		expect(headerCount).toBe(1);
		// Must NOT bleed into the alphabetically/positionally neighboring sections.
		expect(section).not.toContain("clv:checklist");
		expect(section).not.toContain("clv:diff");
	});

	test("an unknown block name returns null", () => {
		expect(extractBlockSection(styleDoc, "bogus")).toBeNull();
	});

	test("a header token must match WITH its closing backtick (no clv:codeX bleed)", () => {
		// Synthetic doc: `clv:cod` must not match the `clv:code` header.
		const synthetic = "### `clv:code`\n\nbody for code\n\n### `clv:diff`\n\nbody for diff\n";
		expect(extractBlockSection(synthetic, "cod")).toBeNull();
		const codeSection = extractBlockSection(synthetic, "code");
		expect(codeSection).toContain("body for code");
		expect(codeSection).not.toContain("body for diff");
	});

	test("a mid-file block (metrics) extracts cleanly and stops at the next header", () => {
		const section = extractBlockSection(styleDoc, "metrics");
		expect(section).not.toBeNull();
		expect(section).toContain("### `clv:metrics`");
		expect((section as string).match(/^### `clv:/gm)?.length ?? 0).toBe(1);
		// metrics is followed by clv:mermaid in the file — it must not be included.
		expect(section).not.toContain("clv:mermaid");
	});

	test("the last block in the file extracts to EOF without trailing junk", () => {
		// `clv:tree` is the final `### clv:` section in the file.
		const section = extractBlockSection(styleDoc, "tree") as string;
		expect(section).not.toBeNull();
		expect(section).toContain("### `clv:tree`");
		expect(section.match(/^### `clv:/gm)?.length ?? 0).toBe(1);
		// Trimmed to end in exactly one trailing newline.
		expect(section.endsWith("\n")).toBe(true);
		expect(section.endsWith("\n\n")).toBe(false);
		// It contains the worked example fence for tree.
		expect(section).toContain("```clv:tree");
	});
});

describe("renderDoc", () => {
	test("no arg returns ok and text byte-equals the on-disk showcase", () => {
		const result = renderDoc(undefined);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok");
		expect(result.text).toBe(showcaseOnDisk);
	});

	test("a valid block returns ok with its schema + worked example fence", () => {
		const result = renderDoc("callout");
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok");
		expect(result.text).toContain("`clv:callout`");
		expect(result.text).toContain("```clv:callout");
	});

	test("an unknown block returns not-ok with an error listing all 14 blocks and the bad name", () => {
		const result = renderDoc("bogus");
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected not-ok");
		expect(result.error).toContain("bogus");
		expect(result.error).toContain("Valid blocks:");
		for (const name of blockNames) {
			expect(result.error).toContain(name);
		}
	});
});

describe("showcase document (no-arg correctness)", () => {
	// `clv doc` prints examples/showcase.clv.md verbatim. That document must itself
	// parse without any fallback so the showcase never demonstrates a broken block.
	const { doc, hadError } = parseDocument(showcaseOnDisk, { title: "x", theme: "auto" });

	test("parses with no error and zero fallback nodes", () => {
		expect(hadError).toBe(false);
		expect(doc.nodes.filter((n) => n.kind === "fallback")).toHaveLength(0);
	});

	test("every one of the 14 block types appears among the block nodes", () => {
		const present = new Set(
			doc.nodes.filter((n) => n.kind === "block").map((n) => (n as { block: { type: string } }).block.type),
		);
		expect(present).toEqual(new Set(blockNames));
	});
});

describe("runDoc — stdout I/O", () => {
	let spy: ReturnType<typeof spyOn<typeof process.stdout, "write">>;

	afterEach(() => {
		spy?.mockRestore();
	});

	function captureRunDoc(block?: string): string {
		let captured = "";
		spy = spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
			captured += typeof chunk === "string" ? chunk : String(chunk);
			return true;
		});
		runDoc(block);
		return captured;
	}

	test("runDoc() writes the showcase byte-for-byte to stdout", () => {
		const out = captureRunDoc();
		expect(out).toBe(showcaseOnDisk);
	});

	test("runDoc('callout') writes the callout section to stdout", () => {
		const out = captureRunDoc("callout");
		const section = extractBlockSection(styleDoc, "callout");
		expect(section).not.toBeNull();
		expect(out).toBe(section as string);
	});
});
