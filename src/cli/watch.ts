import { type FSWatcher, statSync, watch } from "node:fs";
import { resolve } from "node:path";

import { isMarkdownPath } from "./session";

// Filesystem watcher for serve mode. Implemented on `node:fs` watch.
//
// IMPLEMENTATION NOTE / SWAP POINT: recursive `fs.watch({ recursive: true })`
// works on macOS and Windows but is unsupported on older Linux kernels (it
// silently ignores the flag, so subdirectory changes never fire). If recursive
// directory watching on Linux becomes a problem, THIS FILE is the single place
// to swap the `node:fs` implementation for `chokidar`. Do not add chokidar yet.
//
// Directories are watched with `fs.watch` (above). Directly-watched FILES are
// instead tracked by a stat poll (an ino/mtime/size/exists snapshot), not
// `fs.watch`: an editor atomic save (write temp file + rename over the target —
// vim, Neovim, many formatters) swaps the file's inode, and `fs.watch` can miss
// the replacement entirely — on Bun/Linux it emits no event at all. Polling the
// stat snapshot is the only reliable cross-platform signal for that case.

export type WatchEvent = {
	type: "change" | "add" | "unlink";
	path: string; // absolute
};

// Trailing-debounce window (ms). fs.watch emits duplicate/rapid events for a
// single logical change; we coalesce per-path and emit once the dust settles,
// re-stat'ing at that point so the final event reflects the post-change state.
const DEBOUNCE_MS = 80;

const DIRECT_FILE_POLL_MS = 250;

type FileSnapshot = {
	exists: boolean;
	ino?: number;
	mtimeMs?: number;
	size?: number;
};

function exists(path: string): boolean {
	try {
		statSync(path);
		return true;
	} catch {
		return false;
	}
}

function snapshot(path: string): FileSnapshot {
	try {
		const stat = statSync(path);
		return {
			exists: true,
			ino: stat.ino,
			mtimeMs: stat.mtimeMs,
			size: stat.size,
		};
	} catch {
		return { exists: false };
	}
}

function sameSnapshot(a: FileSnapshot, b: FileSnapshot): boolean {
	return a.exists === b.exists && a.ino === b.ino && a.mtimeMs === b.mtimeMs && a.size === b.size;
}

export function createWatcher(
	opts: { files: string[]; dirs: string[]; recursive: boolean },
	onEvent: (e: WatchEvent) => void,
): { close(): void; add(more: { files: string[]; dirs: string[] }): void } {
	// Paths we currently believe exist, used to distinguish add vs change for
	// directory events (a path we've never seen before that now exists is an add).
	const known = new Set<string>();
	// Absolute paths of watched DIRECTORIES for which a handle is already
	// installed. File dedup is handled by `directFileSnapshots.has(abs)` instead;
	// this set tracks directories so repeated add() of the same dir on the
	// long-lived daemon does not stack duplicate handles.
	const watchedAbs = new Set<string>();
	// Directory watchers: these never need rewatch logic, so they stay in a flat
	// array keyed only by `watchedAbs` for dedup.
	const dirWatchers: FSWatcher[] = [];
	const directFileSnapshots = new Map<string, FileSnapshot>();
	let directFilePoller: ReturnType<typeof setInterval> | undefined;
	const timers = new Map<string, ReturnType<typeof setTimeout>>();

	const schedule = (path: string): void => {
		const existing = timers.get(path);
		if (existing) clearTimeout(existing);
		timers.set(
			path,
			setTimeout(() => {
				timers.delete(path);
				const here = exists(path);
				if (here) {
					if (directFileSnapshots.has(path)) directFileSnapshots.set(path, snapshot(path));
					const type = known.has(path) ? "change" : "add";
					known.add(path);
					onEvent({ type, path });
				} else if (known.delete(path)) {
					if (directFileSnapshots.has(path)) directFileSnapshots.set(path, { exists: false });
					// Was known, now gone → unlink. (If never known, ignore: a transient
					// temp file the editor created and removed.)
					onEvent({ type: "unlink", path });
				}
			}, DEBOUNCE_MS),
		);
	};

	const pollDirectFiles = (): void => {
		for (const [abs, previous] of directFileSnapshots) {
			const next = snapshot(abs);
			if (sameSnapshot(previous, next)) continue;
			directFileSnapshots.set(abs, next);
			schedule(abs);
		}
	};

	const startDirectFilePoller = (): void => {
		if (directFilePoller) return;
		directFilePoller = setInterval(pollDirectFiles, DIRECT_FILE_POLL_MS);
	};

	const watchFile = (file: string): void => {
		const abs = resolve(file);
		known.add(abs);
		// Dedup: a file already being polled needs no second snapshot/poller.
		if (directFileSnapshots.has(abs)) return;
		directFileSnapshots.set(abs, snapshot(abs));
		startDirectFilePoller();
	};

	const watchDir = (dir: string): void => {
		const absDir = resolve(dir);
		if (watchedAbs.has(absDir)) return;
		try {
			dirWatchers.push(
				watch(absDir, { recursive: opts.recursive }, (_event, filename) => {
					if (!filename) return;
					const abs = resolve(absDir, filename.toString());
					// Only care about markdown within watched directories.
					if (!isMarkdownPath(abs)) return;
					schedule(abs);
				}),
			);
			watchedAbs.add(absDir);
		} catch {
			// Directory vanished before we could watch it; ignore.
		}
	};

	for (const f of opts.files) watchFile(f);
	for (const d of opts.dirs) watchDir(d);

	return {
		add(more) {
			for (const f of more.files) watchFile(f);
			for (const d of more.dirs) watchDir(d);
		},
		close() {
			for (const t of timers.values()) clearTimeout(t);
			timers.clear();
			if (directFilePoller) clearInterval(directFilePoller);
			directFilePoller = undefined;
			directFileSnapshots.clear();
			for (const w of dirWatchers) w.close();
			dirWatchers.length = 0;
			watchedAbs.clear();
		},
	};
}
