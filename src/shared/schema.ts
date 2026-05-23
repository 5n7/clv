// Per-block zod schemas (SPEC §7) plus the document-level schema.
//
// These are HAND-WRITTEN to mirror src/shared/types.ts exactly. We do NOT derive
// types.ts from zod (it would fight the existing imports across CLI + web).
// Sync is guaranteed by the compile-time assertions at the bottom of this file:
// each `z.infer<typeof xSchema>` must be assignable to the hand-written type.
//
// Per-block schemas are intentionally LENIENT (no `.strict()`): the fenced-header
// attribute merge can introduce keys the schema does not model, and we do not want
// validation to reject Claude's harmless extras. `documentSchema` stays strict.

import type {
	Block,
	Callout,
	Chart,
	ChartType,
	Checklist,
	Code,
	Diff,
	FileChange,
	Findings,
	Graph,
	Metrics,
	Severity,
	Status,
	Steps,
	Table,
	Tabs,
	Timeline,
	Tree,
	Trend,
} from "@shared/types";
import { z } from "zod";

/* ---------- common enums (SPEC §6.4) ---------- */
export const severitySchema = z.enum(["critical", "danger", "warning", "tip", "info"]);
export const statusSchema = z.enum(["pass", "fail", "na", "skip"]);
export const fileChangeSchema = z.enum(["added", "modified", "deleted", "renamed"]);
export const trendSchema = z.enum(["up", "down", "neutral"]);
export const chartTypeSchema = z.enum(["bar", "line", "pie", "area", "scatter"]);

/* ---------- common optional fields (SPEC §6.2) ---------- */
// Spread into every block data schema. Not its own object so per-block schemas
// stay flat (and lenient about extra keys).
const commonFields = {
	title: z.string().optional(),
	collapsed: z.boolean().optional(),
	id: z.string().optional(),
};

// Cell / data values across chart, table, metrics.
const scalarSchema = z.union([z.string(), z.number()]);

/* ---------- per-block data schemas (SPEC §7) ---------- */

// §7.1 callout
export const calloutSchema = z.object({
	...commonFields,
	kind: severitySchema,
	body: z.string(),
});

// §7.2 code
const codeAnnotationSchema = z.object({
	line: z.number(),
	kind: severitySchema.optional(),
	text: z.string(),
});
export const codeSchema = z.object({
	...commonFields,
	lang: z.string(),
	file: z.string().optional(),
	source: z.string(),
	startLine: z.number().optional(),
	annotations: z.array(codeAnnotationSchema).optional(),
	highlightLines: z.array(z.number()).optional(),
});

// §7.3 diff
export const diffSchema = z.object({
	...commonFields,
	lang: z.string().optional(),
	file: z.string().optional(),
	mode: z.enum(["unified", "split"]).optional(),
	from: z.string(),
	to: z.string(),
});

// §7.4 tree
const treeNodeSchema = z.object({
	path: z.string(),
	status: fileChangeSchema.optional(),
	note: z.string().optional(),
	// Restrict href schemes so a malicious/hallucinated "javascript:" URL can't execute in the shared HTML.
	href: z
		.string()
		.refine((s) => !s.startsWith("//"), { message: "href must not be protocol-relative (//...)" })
		.refine((s) => /^(https?:\/\/|mailto:|#|\/[^/]|\.\/|\.\.\/)/i.test(s), {
			message: "href must be http(s), mailto, anchor, or relative",
		})
		.optional(),
});
export const treeSchema = z.object({
	...commonFields,
	nodes: z.array(treeNodeSchema),
});

// §7.5 findings
const findingSchema = z.object({
	severity: severitySchema,
	file: z.string().optional(),
	line: z.number().optional(),
	title: z.string(),
	body: z.string().optional(),
	blockId: z.string().optional(),
});
export const findingsSchema = z.object({
	...commonFields,
	items: z.array(findingSchema),
});

// §7.6 checklist
const checklistItemSchema = z.object({
	label: z.string(),
	status: statusSchema,
	note: z.string().optional(),
});
export const checklistSchema = z.object({
	...commonFields,
	items: z.array(checklistItemSchema),
});

// §7.7 metrics
const metricItemSchema = z.object({
	label: z.string(),
	value: scalarSchema,
	delta: z.string().optional(),
	trend: trendSchema.optional(),
	hint: z.string().optional(),
});
export const metricsSchema = z.object({
	...commonFields,
	items: z.array(metricItemSchema),
	columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional(),
});

// §7.8 chart
export const chartSchema = z.object({
	...commonFields,
	type: chartTypeSchema,
	data: z.array(z.record(z.string(), scalarSchema)),
	xKey: z.string(),
	yKeys: z.array(z.string()),
	stacked: z.boolean().optional(),
	height: z.number().optional(),
});

// §7.9 table
const tableColumnSchema = z.object({
	key: z.string(),
	label: z.string(),
	align: z.enum(["left", "right", "center"]).optional(),
	lang: z.string().optional(),
	sortable: z.boolean().optional(),
});
export const tableSchema = z.object({
	...commonFields,
	columns: z.array(tableColumnSchema),
	rows: z.array(z.record(z.string(), scalarSchema)),
	caption: z.string().optional(),
});

// §7.10 graph
const graphNodeSchema = z.object({
	id: z.string(),
	label: z.string(),
	group: z.string().optional(),
	shape: z.enum(["rect", "circle"]).optional(),
	x: z.number().optional(),
	y: z.number().optional(),
});
const graphEdgeSchema = z.object({
	from: z.string(),
	to: z.string(),
	label: z.string().optional(),
	style: z.enum(["solid", "dashed"]).optional(),
});
export const graphSchema = z.object({
	...commonFields,
	layout: z.enum(["dagre", "force", "manual"]).optional(),
	direction: z.enum(["TB", "LR"]).optional(),
	nodes: z.array(graphNodeSchema),
	edges: z.array(graphEdgeSchema),
});

// §7.11 timeline
const timelineEventSchema = z.object({
	at: z.string(),
	title: z.string(),
	body: z.string().optional(),
	kind: severitySchema.optional(),
});
export const timelineSchema = z.object({
	...commonFields,
	orientation: z.enum(["vertical", "horizontal"]).optional(),
	events: z.array(timelineEventSchema),
});

// §7.12 mermaid
export const mermaidSchema = z.object({
	...commonFields,
	source: z.string(),
});

// §7.13 tabs (recursive: a tab can nest another Block)
const tabItemSchema = z.object({
	label: z.string(),
	content: z.string().optional(),
	get block() {
		return blockSchema.optional();
	},
});
export const tabsSchema = z.object({
	...commonFields,
	tabs: z.array(tabItemSchema),
});

// §7.14 steps (recursive: a step can nest another Block)
const stepItemSchema = z.object({
	title: z.string(),
	body: z.string().optional(),
	get block() {
		return blockSchema.optional();
	},
});
export const stepsSchema = z.object({
	...commonFields,
	steps: z.array(stepItemSchema),
	initial: z.number().optional(),
});

/* ---------- Block discriminated union (SPEC §7.15, recursive via z.lazy) ---------- */
// Explicit annotation is required so the recursive union satisfies TS.
export const blockSchema: z.ZodType<Block> = z.lazy(() =>
	z.discriminatedUnion("type", [
		z.object({ type: z.literal("callout"), data: calloutSchema }),
		z.object({ type: z.literal("code"), data: codeSchema }),
		z.object({ type: z.literal("diff"), data: diffSchema }),
		z.object({ type: z.literal("tree"), data: treeSchema }),
		z.object({ type: z.literal("findings"), data: findingsSchema }),
		z.object({ type: z.literal("checklist"), data: checklistSchema }),
		z.object({ type: z.literal("metrics"), data: metricsSchema }),
		z.object({ type: z.literal("chart"), data: chartSchema }),
		z.object({ type: z.literal("table"), data: tableSchema }),
		z.object({ type: z.literal("graph"), data: graphSchema }),
		z.object({ type: z.literal("timeline"), data: timelineSchema }),
		z.object({ type: z.literal("mermaid"), data: mermaidSchema }),
		z.object({ type: z.literal("tabs"), data: tabsSchema }),
		z.object({ type: z.literal("steps"), data: stepsSchema }),
	]),
);

// Per-type map: validate a block's `data` payload by its `type` tag.
export const blockDataSchemas = {
	callout: calloutSchema,
	code: codeSchema,
	diff: diffSchema,
	tree: treeSchema,
	findings: findingsSchema,
	checklist: checklistSchema,
	metrics: metricsSchema,
	chart: chartSchema,
	table: tableSchema,
	graph: graphSchema,
	timeline: timelineSchema,
	mermaid: mermaidSchema,
	tabs: tabsSchema,
	steps: stepsSchema,
} as const;

export type KnownBlockType = keyof typeof blockDataSchemas;

/* ---------- Document (intermediate representation, SPEC §8.2) ---------- */
const docNodeSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("markdown"), markdown: z.string(), id: z.string().optional() }),
	z.object({ kind: z.literal("block"), block: blockSchema, id: z.string().optional() }),
	z.object({
		kind: z.literal("fallback"),
		blockType: z.string(),
		raw: z.string(),
		error: z.string(),
		id: z.string().optional(),
	}),
]);

export const documentSchema = z.object({
	title: z.string(),
	theme: z.enum(["auto", "light", "dark"]),
	source: z.string().optional(),
	generated: z.string().optional(),
	subtitle: z.string().optional(),
	nodes: z.array(docNodeSchema),
});

export type DocumentInput = z.infer<typeof documentSchema>;

/* ---------- compile-time sync guarantee ----------
 * Each inferred schema type must be assignable to the hand-written types.ts type.
 * If types.ts and schema.ts drift, one of these `Expect` rows resolves to `never`
 * and the union below fails to compile. Type-only — no runtime footprint. */
type Expect<S extends T, T> = S;
type SyncCheck =
	| Expect<z.infer<typeof calloutSchema>, Callout>
	| Expect<z.infer<typeof codeSchema>, Code>
	| Expect<z.infer<typeof diffSchema>, Diff>
	| Expect<z.infer<typeof treeSchema>, Tree>
	| Expect<z.infer<typeof findingsSchema>, Findings>
	| Expect<z.infer<typeof checklistSchema>, Checklist>
	| Expect<z.infer<typeof metricsSchema>, Metrics>
	| Expect<z.infer<typeof chartSchema>, Chart>
	| Expect<z.infer<typeof tableSchema>, Table>
	| Expect<z.infer<typeof graphSchema>, Graph>
	| Expect<z.infer<typeof timelineSchema>, Timeline>
	| Expect<z.infer<typeof tabsSchema>, Tabs>
	| Expect<z.infer<typeof stepsSchema>, Steps>
	| Expect<z.infer<typeof severitySchema>, Severity>
	| Expect<z.infer<typeof statusSchema>, Status>
	| Expect<z.infer<typeof fileChangeSchema>, FileChange>
	| Expect<z.infer<typeof trendSchema>, Trend>
	| Expect<z.infer<typeof chartTypeSchema>, ChartType>;
export type { SyncCheck };
