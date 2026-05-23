import type { Document, FileEntry } from "@shared/types";
import { createHash } from "node:crypto";
import type { Dirent, Stats } from "node:fs";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

import { parseDocument } from "./parse";

// File registry + id/title derivation for serve mode (PURE — no Bun.serve here).
// serve.ts owns the HTTP/WS layer and consumes this.

// `FileEntry` lives in @shared/types (the wire shape is shared with the web SPA);
// re-export it here so existing CLI imports of `./session` keep working.
export type { FileEntry };

// Markdown file extensions we recognize when expanding directories.
const MARKDOWN_EXTS = new Set([".md", ".markdown"]);

export function isMarkdownPath(path: string): boolean {
	return MARKDOWN_EXTS.has(extname(path).toLowerCase());
}

// Stable, opaque, deterministic id for a file. We hash the ABSOLUTE path rather
// than a root-relative path so adding files from new locations later never
// shifts existing ids.
export function fileIdFromPath(absPath: string): string {
	return "f-" + createHash("sha1").update(absPath).digest("hex").slice(0, 12);
}

// The first ATX heading text (`# …`), trimmed of an optional closing run of `#`,
// or undefined if the markdown has no heading.
export function firstHeading(markdown: string): string | undefined {
	const match = markdown.match(/^#{1,6}\s+(.+?)\s*#*\s*$/m);
	return match ? match[1]!.trim() : undefined;
}

export class Session {
	// Ordered map: insertion order is the file order shown in the UI. Each entry
	// carries its sidebar `group` (see register's last-write-wins note).
	private readonly files = new Map<string, { path: string; group: string }>();

	// mtime-keyed memoization of derived titles so `list()` (called on every
	// `GET /api/files` and `files-changed` broadcast) does not re-read every file
	// each time. Keyed by file id; the cached title is reused only while the file's
	// mtime is unchanged, so an edit (which bumps mtime) re-reads and re-derives.
	private readonly titleCache = new Map<string, { mtimeMs: number; title: string }>();

	// Add each path under `group` (dedup by id). Non-existent paths are tolerated
	// here; the CLI validates existence before constructing the session.
	//
	// LAST-WRITE-WINS: re-registering an already-known file UPDATES its group to
	// the new one (mirrors mo's accretion — the most recent invocation's group
	// labels the file). Insertion order is preserved on update (Map.set keeps the
	// original key position), so the file does not jump in the list.
	register(absPaths: string[], group: string): void {
		for (const path of absPaths) {
			const id = fileIdFromPath(path);
			const existing = this.files.get(id);
			if (existing) existing.group = group;
			else this.files.set(id, { path, group });
		}
	}

	has(id: string): boolean {
		return this.files.has(id);
	}

	// Drop a file by id (no-op if unknown). Used when a watched file is unlinked.
	remove(id: string): void {
		this.files.delete(id);
		this.titleCache.delete(id);
	}

	// Drop a file by its absolute path (no-op if not registered).
	removeByPath(absPath: string): void {
		this.remove(fileIdFromPath(absPath));
	}

	pathOf(id: string): string | undefined {
		return this.files.get(id)?.path;
	}

	// List every registered file with its derived title. Titles are memoized by
	// mtime (see `titleCache`) so repeated calls don't re-read unchanged files; an
	// edit bumps mtime and triggers a fresh read, so the title still reflects the
	// current first heading.
	list(): FileEntry[] {
		const entries: FileEntry[] = [];
		for (const [id, { path, group }] of this.files) {
			const displayName = basename(path);
			entries.push({ id, path, displayName, title: this.titleFor(id, path, displayName), group });
		}
		return entries;
	}

	// Lightweight registry view: path + group only, WITHOUT resolving titles (no
	// stat/read). Used by the session-persistence notify path, which needs only
	// path/group; `list()` would do wasted title work there. New objects, so the
	// internal map entries aren't exposed for mutation.
	entries(): Array<{ path: string; group: string }> {
		return [...this.files.values()].map(({ path, group }) => ({ path, group }));
	}

	// Resolve the title for a file, reusing the cache while its mtime is unchanged.
	// Falls back to `displayName` (the basename) when there's no heading or the
	// file can't be stat'd/read — identical to the prior un-cached behavior.
	private titleFor(id: string, path: string, displayName: string): string {
		let mtimeMs: number;
		try {
			mtimeMs = statSync(path).mtimeMs;
		} catch {
			// Can't stat (e.g. deleted mid-session): don't trust the cache; fall back.
			return displayName;
		}
		const cached = this.titleCache.get(id);
		if (cached && cached.mtimeMs === mtimeMs) return cached.title;
		let title = displayName;
		try {
			const heading = firstHeading(readFileSync(path, "utf8"));
			if (heading) title = heading;
		} catch {
			// Unreadable file: fall back to the basename as the title.
		}
		this.titleCache.set(id, { mtimeMs, title });
		return title;
	}

	// Read + parse the file behind `id` into a Document. Always non-strict: bad
	// blocks render as fallbacks rather than failing the request. Returns
	// undefined when the id is unknown.
	async loadDoc(id: string, opts: { theme: "auto" | "light" | "dark" }): Promise<Document | undefined> {
		const path = this.pathOf(id);
		if (!path) return undefined;
		// The file can be deleted mid-session (watcher hasn't fired the unlink yet).
		// Treat a failed read as "unknown" so callers 404 rather than 500.
		let text: string;
		try {
			text = await Bun.file(path).text();
		} catch {
			return undefined;
		}
		const name = basename(path);
		const { doc } = parseDocument(text, {
			title: firstHeading(text) ?? name,
			theme: opts.theme,
			source: name,
		});
		return doc;
	}
}

// Resolve each input path into the absolute `.md`/`.markdown` files to register
// and the directory roots to watch:
//   - a file → recorded as a file (regardless of extension; explicit user intent)
//   - a directory → its `.md`/`.markdown` files are collected (recursively when
//     `recursive`), and the directory itself is recorded as a watch root
// `files` is deduped and sorted (readdir order is not stable); `dirs` are the
// directory roots (sorted, deduped) the watcher should observe.
export function expandPaths(paths: string[], opts: { recursive: boolean }): { files: string[]; dirs: string[] } {
	const files = new Set<string>();
	const dirs = new Set<string>();

	const walkDir = (dir: string): void => {
		dirs.add(dir);
		let entries: Dirent[];
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (opts.recursive) walkDir(full);
			} else if (entry.isFile() && isMarkdownPath(full)) {
				files.add(full);
			}
		}
	};

	for (const p of paths) {
		const abs = resolve(p);
		let stat: Stats;
		try {
			stat = statSync(abs);
		} catch {
			// Non-existent path: record it as a file so callers can decide how to
			// surface the error; it simply won't load.
			files.add(abs);
			continue;
		}
		if (stat.isDirectory()) {
			walkDir(abs);
		} else {
			files.add(abs);
		}
	}

	return {
		files: [...files].sort(),
		dirs: [...dirs].sort(),
	};
}
