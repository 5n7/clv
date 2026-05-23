import type { FileEntry } from "@shared/types";
import { type ReactNode, useMemo, useState } from "react";

import { Icon } from "../components/Icon";
import { buildFileTree, type DisplayMode, displayLabel, filterFiles, type TreeNode } from "./fileTree";

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

	let list: ReactNode;
	if (filtered.length === 0) {
		list = <div className="clv-sidebar-empty">no files match</div>;
	} else if (view === "flat") {
		list = <FlatList files={filtered} currentId={currentId} nameMode={nameMode} onSelect={onSelect} />;
	} else {
		list = <TreeList nodes={buildFileTree(filtered)} currentId={currentId} nameMode={nameMode} onSelect={onSelect} />;
	}

	return (
		<div className="clv-sidebar">
			<h6>Files</h6>
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

			{list}
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
