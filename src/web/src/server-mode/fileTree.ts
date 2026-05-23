import type { FileEntry } from "@shared/types";

// Pure, DOM-free helpers backing the serve-mode file navigator (Sidebar).
// Unit-tested in fileTree.test.ts.

export type DisplayMode = "name" | "title";

export type TreeNode =
	| { kind: "dir"; name: string; path: string; children: TreeNode[] }
	| { kind: "file"; name: string; entry: FileEntry };

// How a file entry is labelled in the sidebar list/tree.
export function displayLabel(entry: FileEntry, mode: DisplayMode): string {
	if (mode === "title") return entry.title || entry.displayName;
	return entry.displayName;
}

// Case-insensitive substring match against BOTH displayName and title so a
// search hits whichever the user is thinking in.
export function filterFiles(files: FileEntry[], query: string): FileEntry[] {
	const q = query.trim().toLowerCase();
	if (!q) return files;
	return files.filter((f) => f.displayName.toLowerCase().includes(q) || f.title.toLowerCase().includes(q));
}

// Are there any NAMED groups (a group other than "default")? When false, the
// sidebar renders the flat/tree list unchanged; when true, it renders the
// grouped (Option-A) sections.
export function hasNamedGroups(files: FileEntry[]): boolean {
	return files.some((f) => f.group !== "default");
}

// Group files into named sections, preserving first-seen group order AND file
// order within each group. Used by the Option-A grouped sidebar. Display-only:
// the group never affects routing (files keep their globally-unique `?file=<id>`).
export function groupFiles(files: FileEntry[]): Array<{ group: string; files: FileEntry[] }> {
	const order: string[] = [];
	const byGroup = new Map<string, FileEntry[]>();
	for (const f of files) {
		let bucket = byGroup.get(f.group);
		if (!bucket) {
			bucket = [];
			byGroup.set(f.group, bucket);
			order.push(f.group);
		}
		bucket.push(f);
	}
	return order.map((group) => ({ group, files: byGroup.get(group)! }));
}

// Build a directory hierarchy from each entry's `path`, rooted below the longest
// common directory prefix so the tree isn't buried under shared ancestors.
// Directories are sorted before files; both alphabetically within their group.
export function buildFileTree(files: FileEntry[]): TreeNode[] {
	const trim = commonDirPrefix(files.map((f) => f.path)).length;
	const root: TreeNode[] = [];
	// Track dir nodes by their joined path so siblings reuse the same node.
	const dirIndex = new Map<string, Extract<TreeNode, { kind: "dir" }>>();

	for (const entry of files) {
		const segs = segments(entry.path).slice(trim);
		const fileName = segs[segs.length - 1] ?? entry.displayName;
		const dirSegs = segs.slice(0, -1);

		let level = root;
		let accum = "";
		for (const seg of dirSegs) {
			accum = accum ? `${accum}/${seg}` : seg;
			let dir = dirIndex.get(accum);
			if (!dir) {
				dir = { kind: "dir", name: seg, path: accum, children: [] };
				dirIndex.set(accum, dir);
				level.push(dir);
			}
			level = dir.children;
		}
		level.push({ kind: "file", name: fileName, entry });
	}

	sortLevel(root);
	return root;
}

// Split a path into segments, dropping a leading "/" (so absolute and relative
// paths produce comparable segment arrays) and any empty segments. Splits on
// BOTH separators so Windows paths (backslash) nest correctly, not as a flat
// list.
function segments(path: string): string[] {
	return path.split(/[\\/]/).filter((s) => s.length > 0);
}

// Longest common DIRECTORY prefix across all paths, compared per-segment (not
// per-character, so "/a/bb/x" and "/a/b/y" only share "/a"). The final segment
// of each path is its filename and never counts toward the shared prefix.
function commonDirPrefix(paths: string[]): string[] {
	if (paths.length === 0) return [];
	// Each path's directory portion = all but the last segment.
	const dirs = paths.map((p) => segments(p).slice(0, -1));
	let prefix = dirs[0] ?? [];
	for (const d of dirs.slice(1)) {
		let i = 0;
		while (i < prefix.length && i < d.length && prefix[i] === d[i]) i++;
		prefix = prefix.slice(0, i);
		if (prefix.length === 0) break;
	}
	return prefix;
}

function sortLevel(level: TreeNode[]): void {
	level.sort((a, b) => {
		if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
		return a.name.localeCompare(b.name);
	});
	for (const node of level) {
		if (node.kind === "dir") sortLevel(node.children);
	}
}
