// Shared block contract used by both the CLI (parse/inject) and the web SPA
// (render). Mirrors SPEC §6.4 (enums), §7 (block catalog) and §8.2 (Document).

/* ---------- common enums (SPEC §6.4) ---------- */
export type Severity = "critical" | "danger" | "warning" | "tip" | "info";
export type Status = "pass" | "fail" | "na" | "skip";
export type FileChange = "added" | "modified" | "deleted" | "renamed";
export type Trend = "up" | "down" | "neutral";
export type ChartType = "bar" | "line" | "pie" | "area" | "scatter";

/* ---------- common optional fields (SPEC §6.2) ---------- */
export type CommonFields = {
	title?: string;
	collapsed?: boolean;
	id?: string;
};

/* ---------- block data shapes (SPEC §7) ---------- */

// §7.1 callout
export type Callout = CommonFields & {
	kind: Severity;
	body: string;
};

// §7.2 code
export type CodeAnnotation = {
	line: number;
	kind?: Severity;
	text: string;
};
export type Code = CommonFields & {
	lang: string;
	file?: string;
	source: string;
	startLine?: number;
	annotations?: CodeAnnotation[];
	highlightLines?: number[];
};

// §7.3 diff
export type Diff = CommonFields & {
	lang?: string;
	file?: string;
	mode?: "unified" | "split";
	from: string;
	to: string;
};

// §7.4 tree
export type TreeNode = {
	path: string;
	status?: FileChange;
	note?: string;
	href?: string;
};
export type Tree = CommonFields & {
	nodes: TreeNode[];
};

// §7.5 findings
export type Finding = {
	severity: Severity;
	file?: string;
	line?: number;
	title: string;
	body?: string;
	blockId?: string;
};
export type Findings = CommonFields & {
	items: Finding[];
};

// §7.6 checklist
export type ChecklistItem = {
	label: string;
	status: Status;
	note?: string;
};
export type Checklist = CommonFields & {
	items: ChecklistItem[];
};

// §7.7 metrics
export type MetricItem = {
	label: string;
	value: string | number;
	delta?: string;
	trend?: Trend;
	hint?: string;
};
export type Metrics = CommonFields & {
	items: MetricItem[];
	columns?: 2 | 3 | 4;
};

// §7.8 chart
export type Chart = CommonFields & {
	type: ChartType;
	data: Array<Record<string, string | number>>;
	xKey: string;
	yKeys: string[];
	stacked?: boolean;
	height?: number;
};

// §7.9 table
export type TableColumn = {
	key: string;
	label: string;
	align?: "left" | "right" | "center";
	lang?: string;
	sortable?: boolean;
};
export type Table = CommonFields & {
	columns: TableColumn[];
	rows: Array<Record<string, string | number>>;
	caption?: string;
};

// §7.10 graph
export type GraphNode = {
	id: string;
	label: string;
	group?: string;
	shape?: "rect" | "circle";
	// Used only when layout is "manual"; ignored otherwise (SPEC §7.10).
	x?: number;
	y?: number;
};
export type GraphEdge = {
	from: string;
	to: string;
	label?: string;
	style?: "solid" | "dashed";
};
export type Graph = CommonFields & {
	layout?: "dagre" | "force" | "manual";
	direction?: "TB" | "LR";
	nodes: GraphNode[];
	edges: GraphEdge[];
};

// §7.11 timeline
export type TimelineEvent = {
	at: string;
	title: string;
	body?: string;
	kind?: Severity;
};
export type Timeline = CommonFields & {
	orientation?: "vertical" | "horizontal";
	events: TimelineEvent[];
};

// §7.12 mermaid
export type Mermaid = CommonFields & {
	source: string;
};

// §7.13 tabs (recursive: a tab can nest another Block)
export type TabItem = {
	label: string;
	content?: string;
	block?: Block;
};
export type Tabs = CommonFields & {
	tabs: TabItem[];
};

// §7.14 steps (recursive: a step can nest another Block)
export type StepItem = {
	title: string;
	body?: string;
	block?: Block;
};
export type Steps = CommonFields & {
	steps: StepItem[];
	initial?: number;
};

/* ---------- Block discriminated union (SPEC §7.15) ---------- */
export type Block =
	| { type: "callout"; data: Callout }
	| { type: "code"; data: Code }
	| { type: "diff"; data: Diff }
	| { type: "tree"; data: Tree }
	| { type: "findings"; data: Findings }
	| { type: "checklist"; data: Checklist }
	| { type: "metrics"; data: Metrics }
	| { type: "chart"; data: Chart }
	| { type: "table"; data: Table }
	| { type: "graph"; data: Graph }
	| { type: "timeline"; data: Timeline }
	| { type: "mermaid"; data: Mermaid }
	| { type: "tabs"; data: Tabs }
	| { type: "steps"; data: Steps };

export type BlockType = Block["type"];

/* ---------- Document (intermediate representation) ---------- */
// NOTE: this overrides SPEC §8.2 per the resolved Phase 0 decisions:
// markdown nodes carry raw source (rendered by react-markdown on the web side),
// not pre-rendered HTML or marked tokens.
export type DocNode =
	| { kind: "markdown"; markdown: string; id?: string }
	| { kind: "block"; block: Block; id?: string }
	| { kind: "fallback"; blockType: string; raw: string; error: string; id?: string };

export type Document = {
	title: string;
	theme: "auto" | "light" | "dark";
	source?: string;
	generated?: string;
	subtitle?: string;
	nodes: DocNode[];
};

/* ---------- serve-mode file registry entry ---------- */
// A registered file as exposed by `GET /api/files` and the `files-changed` WS
// message. Lives here (not in src/cli/) because both the CLI and the web SPA
// reference it; `src/shared/` must stay free of CLI/node imports.
export type FileEntry = {
	id: string;
	path: string;
	displayName: string;
	title: string;
};
