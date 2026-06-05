import { blockDataSchemas } from "@shared/schema";

// Text-import the two source documents. Bun inlines the file contents at build
// time (same `type: "text"` pattern as inject.ts's template import), so the CLI
// has no runtime file dependency on examples/ or docs/.
import outputStyleDoc from "../../docs/output-style-clv.md" with { type: "text" };
import showcaseDoc from "../../examples/showcase.clv.md" with { type: "text" };

// The canonical list of valid block names — the keys of `blockDataSchemas`. Used
// for both validation and the unknown-block error, so it can never drift.
const validNames = Object.keys(blockDataSchemas);

// Extract the markdown of the `### \`clv:<type>\`` section from the style doc.
//
// Returns the section text from its `### ` header line up to (but NOT including)
// the next markdown header (`## ` or `### `), or EOF, trimmed to end in a single
// newline. Returns `null` if no such section exists.
//
// Splitting is on markdown HEADER lines only (lines starting with `## ` or `### `),
// so ``` code fences inside a section are preserved verbatim. The header token is
// matched WITH its closing backtick (`clv:<type>\``) so e.g. `clv:code` does not
// match the `clv:checklist` section.
export function extractBlockSection(styleDoc: string, type: string): string | null {
	const header = `### \`clv:${type}\``;
	const lines = styleDoc.split("\n");

	// Find the section's opening header line (exact match on the header token,
	// allowing a trailing " — summary" after the closing backtick).
	let start = -1;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line === header || line?.startsWith(`${header} `)) {
			start = i;
			break;
		}
	}
	if (start === -1) return null;

	// Scan forward to the next markdown header line (or EOF).
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		const line = lines[i];
		if (line?.startsWith("## ") || line?.startsWith("### ")) {
			end = i;
			break;
		}
	}

	return `${lines.slice(start, end).join("\n").trimEnd()}\n`;
}

// Render the `clv doc` payload for an optional block argument.
//
// - no block        → the full showcase document (every block type).
// - valid block     → that block's schema + worked example, from the style doc.
// - unknown block   → an error listing the valid block names.
export function renderDoc(block: string | undefined): { ok: true; text: string } | { ok: false; error: string } {
	if (block === undefined) return { ok: true, text: showcaseDoc };

	if (!validNames.includes(block)) {
		return { ok: false, error: `clv: unknown block "${block}". Valid blocks: ${validNames.join(", ")}` };
	}

	// A valid name always has a section (guaranteed by the doc.test.ts coverage);
	// fall back defensively to the same error if the doc is ever out of sync.
	const section = extractBlockSection(outputStyleDoc, block);
	if (section === null) {
		return { ok: false, error: `clv: unknown block "${block}". Valid blocks: ${validNames.join(", ")}` };
	}
	return { ok: true, text: section };
}

// `clv doc [block]`: print the showcase (no arg) or one block's reference, then
// exit. Both showcaseDoc and the extractor's output already end in exactly one
// trailing newline, so we write the text verbatim.
export function runDoc(block?: string): void {
	const result = renderDoc(block);
	if (!result.ok) {
		console.error(result.error);
		process.exit(1);
	}
	process.stdout.write(result.text);
}
