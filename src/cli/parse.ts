// Markdown + clv:* block parser (SPEC §8).
//
// Flow: tokenize with marked.lexer → walk top-level tokens → clv:<type> / mermaid
// fences become validated blocks (or fallbacks); consecutive non-clv tokens are
// coalesced into a single markdown node. After building nodes, auto-assign stable
// `id`s to code blocks that lack one (SPEC §8.3) so findings anchors resolve.

import { blockDataSchemas, documentSchema, type KnownBlockType } from "@shared/schema";
import type { Block, Code, Document, DocNode } from "@shared/types";
import { walkBlocks } from "@shared/walk";
import { marked, type Tokens } from "marked";
import { createHash } from "node:crypto";

// Hex length for auto-assigned `block-<hash>` ids (SPEC §8.3).
export const CODE_BLOCK_ID_HASH_HEX_LEN = 12;

export type ParseOptions = {
	title: string;
	theme: "auto" | "light" | "dark";
	source?: string;
};

export type ParseResult = {
	doc: Document;
	hadError: boolean;
};

const KNOWN_TYPES = new Set(Object.keys(blockDataSchemas));

export function parseDocument(input: string, opts: ParseOptions): ParseResult {
	const tokens = marked.lexer(input);
	const nodes: DocNode[] = [];
	let hadError = false;

	// Buffer for a run of consecutive non-clv markdown tokens, flushed lazily.
	let mdBuffer = "";
	function flushMarkdown(): void {
		const trimmed = mdBuffer.trim();
		if (trimmed) nodes.push({ kind: "markdown", markdown: trimmed });
		mdBuffer = "";
	}

	for (const token of tokens) {
		const fence = token.type === "code" ? parseFenceLang(token.lang) : null;
		if (!fence) {
			// Plain markdown: accumulate raw source into the current run.
			mdBuffer += token.raw ?? "";
			continue;
		}

		// A clv:* / mermaid fence ends any markdown run before it.
		flushMarkdown();
		const node = parseFenceBlock(fence, token as Tokens.Code);
		if (node.kind === "fallback") hadError = true;
		nodes.push(node);
	}
	flushMarkdown();

	assignIds(nodes);

	const doc: Document = {
		title: opts.title,
		theme: opts.theme,
		source: opts.source,
		generated: new Date().toISOString(),
		nodes,
	};

	const validated = documentSchema.safeParse(doc);
	if (!validated.success) {
		throw new Error(`Internal document validation failed: ${formatZodError(validated.error)}`);
	}

	return { doc: validated.data, hadError };
}

/* ---------- fence header parsing ---------- */

type Fence = { kind: "mermaid" } | { kind: "clv"; type: string; attrs: Record<string, string> };

// Returns the fence descriptor for a clv:* / mermaid info string, else null.
function parseFenceLang(lang: string | undefined): Fence | null {
	if (!lang) return null;
	if (lang === "mermaid") return { kind: "mermaid" };

	const match = lang.match(/^clv:(\S+)/);
	if (!match) return null;

	const type = match[1]!;
	// Everything after `clv:<type>` is the attribute list.
	const rest = lang.slice(match[0].length);
	const attrs: Record<string, string> = {};
	for (const m of rest.matchAll(/(\w+)="([^"]*)"/g)) {
		attrs[m[1]!] = m[2]!;
	}
	return { kind: "clv", type, attrs };
}

/* ---------- fence → block / fallback ---------- */

function parseFenceBlock(fence: Fence, token: Tokens.Code): DocNode {
	const raw = token.raw ?? "";

	// Bare ```mermaid```: the whole body is the Mermaid source (SPEC §7.12 compat).
	if (fence.kind === "mermaid") {
		const block: Block = { type: "mermaid", data: { source: token.text ?? "" } };
		return { kind: "block", block };
	}

	const blockType = `clv:${fence.type}`;

	// Unknown clv:<type> → fallback before any JSON/schema work (SPEC §6.3, §10).
	if (!KNOWN_TYPES.has(fence.type)) {
		return {
			kind: "fallback",
			blockType,
			raw,
			error: `Unknown block type "${fence.type}". Falling back to raw render.`,
		};
	}

	// Parse the JSON body.
	let payload: unknown;
	try {
		payload = JSON.parse(token.text ?? "");
	} catch (err) {
		return {
			kind: "fallback",
			blockType,
			raw,
			error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
		};
	}

	// Merge fence-header attrs into the payload; JSON body wins on conflict (SPEC §6.1).
	const merged =
		payload && typeof payload === "object" && !Array.isArray(payload)
			? { ...fence.attrs, ...(payload as Record<string, unknown>) }
			: payload;

	// Validate the data against the per-type schema.
	const type = fence.type as KnownBlockType;
	const result = blockDataSchemas[type].safeParse(merged);
	if (!result.success) {
		return {
			kind: "fallback",
			blockType,
			raw,
			error: `Schema violation: ${formatZodError(result.error)}`,
		};
	}

	// Cast is sound: the per-type schema validated `data` for this exact `type`.
	const block = { type, data: result.data } as Block;
	return { kind: "block", block };
}

function formatZodError(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
	return error.issues
		.map((i) => {
			const path = i.path.join(".");
			return path ? `${path}: ${i.message}` : i.message;
		})
		.join("; ");
}

/* ---------- recursive ID assignment (SPEC §8.3) ---------- */

function hashString(input: string): string {
	return createHash("sha1").update(input).digest("hex").slice(0, CODE_BLOCK_ID_HASH_HEX_LEN);
}

function hashCode(data: Code): string {
	return hashString(`${data.file ?? ""}\n${data.startLine ?? ""}\n${data.source}`);
}

// De-dup within a document: return `base`, or `base-2`, `base-3`, … on collision.
// Shared by code-block, markdown, and fallback id assignment so the suffix scheme
// stays identical across node kinds.
function allocateUniqueId(base: string, used: Set<string>): string {
	let id = base;
	let n = 2;
	while (used.has(id)) {
		id = `${base}-${n}`;
		n++;
	}
	used.add(id);
	return id;
}

function allocateCodeId(data: Code, used: Set<string>): string {
	return allocateUniqueId(`block-${hashCode(data)}`, used);
}

function assignBlockIds(block: Block, used: Set<string>): void {
	walkBlocks(block, (b) => {
		if (b.type === "code") {
			const data = b.data as Code;
			if (!data.id) {
				data.id = allocateCodeId(data, used);
			} else {
				used.add(data.id);
			}
		}
	});
}

// Give every DocNode a stable, content-derived id (used as React keys so a
// changed/inserted/removed node only remounts itself and preserves scroll):
//   - code blocks (incl. nested tabs[]/steps[]): `block-<hash>` (SPEC §8.3) so
//     findings.blockId anchors resolve. Existing scheme, kept byte-for-byte.
//   - block nodes also receive a node-level `id` (distinct from `block.data.id`):
//     when `block.data.id` is set (top-level code blocks or author-supplied ids)
//     it derives from that value but is deduped in a SEPARATE node-id namespace,
//     so two blocks sharing an authored id don't collide as React keys; else it
//     derives `blk-<hash>` from the block's type + data. `block.data.id` itself is
//     never mutated here (findings anchors / TOC depend on the authored value).
//   - markdown nodes: `md-<hash>` from the markdown source.
//   - fallback nodes: `fb-<hash>` from `blockType + " " + raw`.
// Ids are content-based (editing one node never shifts another node's id) and
// de-duped within a document via a shared `-<n>` suffix scheme.
function assignIds(nodes: DocNode[]): void {
	const usedBlockIds = new Set<string>(); // block.data.id namespace (anchors / auto-id dedup)
	const usedNodeIds = new Set<string>(); // node-level React-key namespace (must be globally unique)
	for (const node of nodes) {
		switch (node.kind) {
			case "block":
				assignBlockIds(node.block, usedBlockIds);
				if (node.block.data.id) {
					// node.id derives from the (possibly authored, possibly duplicate)
					// block.data.id, deduped in the node-id namespace so duplicate authored
					// ids don't collide as React keys. block.data.id itself is left untouched
					// (findings anchors / TOC depend on the authored value). Applies to BOTH
					// code and non-code blocks.
					node.id = allocateUniqueId(node.block.data.id, usedNodeIds);
				} else {
					node.id = allocateUniqueId(
						`blk-${hashString(`${node.block.type}\n${JSON.stringify(node.block.data)}`)}`,
						usedNodeIds,
					);
				}
				break;
			case "markdown":
				node.id = allocateUniqueId(`md-${hashString(node.markdown)}`, usedNodeIds);
				break;
			case "fallback":
				node.id = allocateUniqueId(`fb-${hashString(`${node.blockType} ${node.raw}`)}`, usedNodeIds);
				break;
		}
	}
}
