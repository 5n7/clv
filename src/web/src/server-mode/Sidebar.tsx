import type { FileEntry } from "@shared/types";
import { type ReactNode, useMemo, useState } from "react";

import { Icon } from "../components/Icon";
import {
	buildFileTree,
	type DisplayMode,
	displayLabel,
	filterFiles,
	groupFiles,
	hasNamedGroups,
	type TreeNode,
} from "./fileTree";

const LS_NAME_MODE = "clv:sidebar:nameMode";
const LS_VIEW = "clv:sidebar:view";

type ViewMode = "flat" | "tree";

export type SidebarProps = {
	files: FileEntry[];
	currentId: string | undefined;
	onSelect: (id: string) => void;
};

// Safe localStorage read with a fallback (handles disabled/throwing storage).
function readLs(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}
function writeLs(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Ignore quota / disabled-storage errors — persistence is best-effort.
	}
}

export function Sidebar({ files, currentId, onSelect }: SidebarProps) {
	const [query, setQuery] = useState(""); // search is intentionally not persisted
	const [view, setView] = useState<ViewMode>(() => (readLs(LS_VIEW) === "tree" ? "tree" : "flat"));
	const [nameMode, setNameMode] = useState<DisplayMode>(() => (readLs(LS_NAME_MODE) === "title" ? "title" : "name"));

	const setViewPersisted = (v: ViewMode) => {
		setView(v);
		writeLs(LS_VIEW, v);
	};
	const setNameModePersisted = (m: DisplayMode) => {
		setNameMode(m);
		writeLs(LS_NAME_MODE, m);
	};

	const filtered = useMemo(() => filterFiles(files, query), [files, query]);
	// The grouped vs flat decision and the group list/order are derived from the
	// FULL (unfiltered) set so a group never disappears mid-search: a group whose
	// files all filter out still renders as a thin "no matches" rail (mockup's
	// `.no-match` state). Search then filters WITHIN each group below.
	const grouped = useMemo(() => hasNamedGroups(files), [files]);
	const sections = useMemo(() => (grouped ? groupFiles(files) : []), [grouped, files]);
	const matchedIds = useMemo(() => new Set(filtered.map((f) => f.id)), [filtered]);
	const hasQuery = query.trim().length > 0;

	// Render a file set as the active flat/tree view with the active label mode.
	// Reused for the flat sidebar AND for each group section's body.
	const renderList = (entries: FileEntry[]): ReactNode =>
		view === "flat" ? (
			<FlatList files={entries} currentId={currentId} nameMode={nameMode} onSelect={onSelect} />
		) : (
			<TreeList nodes={buildFileTree(entries)} currentId={currentId} nameMode={nameMode} onSelect={onSelect} />
		);

	// BACKWARD-COMPAT: when there are NO named groups (every file is "default" —
	// the outside-a-git-repo case) render the original flat/tree list unchanged.
	let body: ReactNode;
	if (!grouped) {
		body = filtered.length === 0 ? <div className="clv-sidebar-empty">no files match</div> : renderList(filtered);
	} else {
		// DELIBERATE DIVERGENCE FROM mo: mo gives each group its own sidebar at its
		// own URL path. clv keeps ONE sidebar with collapsible group sections (the
		// provided "Option A" design) because routing is by globally-unique file id
		// (`?file=<id>`), so the group is display-only and never enters the URL.
		body = (
			<nav className="clv-grouplist">
				{sections.map((s) => {
					// Files in this group that survive the current search (search filters
					// across all groups; the intersection is computed per-group here).
					const matched = hasQuery ? s.files.filter((f) => matchedIds.has(f.id)) : s.files;
					return (
						<GroupSection
							key={s.group}
							group={s.group}
							files={matched}
							count={s.files.length}
							// Active = the group HOLDING the current file, computed on the
							// full group (not the search-filtered subset) so searching never
							// drops the active-group accent. Consistent with the count badge.
							active={s.files.some((f) => f.id === currentId)}
							noMatch={hasQuery && matched.length === 0}
							hasQuery={hasQuery}
							renderList={renderList}
						/>
					);
				})}
			</nav>
		);
	}

	return (
		<div className="clv-sidebar">
			{grouped ? (
				<h6>
					Groups<span className="clv-h6-meta">{sections.length}</span>
				</h6>
			) : (
				<h6>Files</h6>
			)}
			<div className="clv-sidebar-tools">
				<div className="clv-sidebar-search">
					<input
						type="text"
						value={query}
						placeholder="filter files…"
						onChange={(e) => setQuery(e.target.value)}
						aria-label="filter files"
					/>
				</div>
				<div className="clv-sidebar-toggles">
					<div className="clv-seg" role="group" aria-label="view mode">
						<button
							className={"clv-seg-btn" + (view === "flat" ? " active" : "")}
							onClick={() => setViewPersisted("flat")}
							title="flat list"
						>
							flat
						</button>
						<button
							className={"clv-seg-btn" + (view === "tree" ? " active" : "")}
							onClick={() => setViewPersisted("tree")}
							title="directory tree"
						>
							tree
						</button>
					</div>
					<div className="clv-seg" role="group" aria-label="label mode">
						<button
							className={"clv-seg-btn" + (nameMode === "name" ? " active" : "")}
							onClick={() => setNameModePersisted("name")}
							title="show file names"
						>
							name
						</button>
						<button
							className={"clv-seg-btn" + (nameMode === "title" ? " active" : "")}
							onClick={() => setNameModePersisted("title")}
							title="show document titles"
						>
							title
						</button>
					</div>
				</div>
			</div>

			{body}
		</div>
	);
}

type GroupSectionProps = {
	group: string;
	// Files in this group that survive the current search (may be empty under a
	// query — see `noMatch`).
	files: FileEntry[];
	// Total file count in the group (badge), independent of the search filter.
	count: number;
	active: boolean;
	// The search filtered every file out of this group → render the dimmed
	// "no matches" rail instead of the file list.
	noMatch: boolean;
	// Whether a search query is active — used for the empty-state copy.
	hasQuery: boolean;
	renderList: (entries: FileEntry[]) => ReactNode;
};

// One collapsible group section (Option A): chevron · mono group name · count
// badge, then the group's files rendered with the SAME flat/tree + name/title
// logic as the flat sidebar. The active group (the one holding the current file)
// gets an accent treatment. No per-file LIVE pill / group live dot: FileEntry has
// no `live` field, so the mockup's liveness affordances are intentionally omitted
// rather than inventing data. Open/closed state defaults to open and is local.
function GroupSection({ group, files, count, active, noMatch, hasQuery, renderList }: GroupSectionProps) {
	const [open, setOpen] = useState(true);
	const emptyMessage = hasQuery ? "no matches in this group" : "no files";
	return (
		<div className={"clv-section" + (active ? " active" : "") + (noMatch ? " no-match" : "")}>
			<button
				className={"clv-section-head" + (open ? " open" : "")}
				onClick={() => setOpen((o) => !o)}
				aria-expanded={open}
				title={group}
			>
				<span className="clv-section-chev">
					<Icon name={open ? "chevDown" : "chevRight"} size={11} />
				</span>
				<span className="clv-section-name">{group}</span>
				<span className="clv-section-count">{count}</span>
			</button>
			{open && (
				<div className="clv-section-files">
					{files.length === 0 ? <div className="clv-section-empty">{emptyMessage}</div> : renderList(files)}
				</div>
			)}
		</div>
	);
}

type FileRowProps = {
	entry: FileEntry;
	active: boolean;
	nameMode: DisplayMode;
	onSelect: (id: string) => void;
	depth: number;
};

function FileRow({ entry, active, nameMode, onSelect, depth }: FileRowProps) {
	return (
		<button
			className={"clv-file-row" + (active ? " active" : "")}
			style={{ paddingLeft: 8 + depth * 12 }}
			onClick={() => onSelect(entry.id)}
			title={entry.path}
		>
			<Icon name="file" size={12} />
			<span className="nm">{displayLabel(entry, nameMode)}</span>
		</button>
	);
}

type FlatListProps = {
	files: FileEntry[];
	currentId: string | undefined;
	nameMode: DisplayMode;
	onSelect: (id: string) => void;
};

function FlatList({ files, currentId, nameMode, onSelect }: FlatListProps) {
	return (
		<nav className="clv-filelist">
			{files.map((f) => (
				<FileRow key={f.id} entry={f} active={f.id === currentId} nameMode={nameMode} onSelect={onSelect} depth={0} />
			))}
		</nav>
	);
}

type TreeListProps = {
	nodes: TreeNode[];
	currentId: string | undefined;
	nameMode: DisplayMode;
	onSelect: (id: string) => void;
};

function TreeList({ nodes, currentId, nameMode, onSelect }: TreeListProps) {
	return (
		<nav className="clv-filelist">
			{nodes.map((n) => (
				<TreeNodeRow
					key={n.kind === "dir" ? `d:${n.path}` : n.entry.id}
					node={n}
					currentId={currentId}
					nameMode={nameMode}
					onSelect={onSelect}
					depth={0}
				/>
			))}
		</nav>
	);
}

type TreeNodeRowProps = {
	node: TreeNode;
	currentId: string | undefined;
	nameMode: DisplayMode;
	onSelect: (id: string) => void;
	depth: number;
};

function TreeNodeRow({ node, currentId, nameMode, onSelect, depth }: TreeNodeRowProps) {
	const [open, setOpen] = useState(true);
	if (node.kind === "file") {
		return (
			<FileRow
				entry={node.entry}
				active={node.entry.id === currentId}
				nameMode={nameMode}
				onSelect={onSelect}
				depth={depth}
			/>
		);
	}
	return (
		<>
			<button
				className="clv-dir-row"
				style={{ paddingLeft: 6 + depth * 12 }}
				onClick={() => setOpen((o) => !o)}
				aria-expanded={open}
			>
				<Icon name={open ? "chevDown" : "chevRight"} size={12} />
				<Icon name="folder" size={12} />
				<span className="nm">{node.name}</span>
			</button>
			{open &&
				node.children.map((c) => (
					<TreeNodeRow
						key={c.kind === "dir" ? `d:${c.path}` : c.entry.id}
						node={c}
						currentId={currentId}
						nameMode={nameMode}
						onSelect={onSelect}
						depth={depth + 1}
					/>
				))}
		</>
	);
}
