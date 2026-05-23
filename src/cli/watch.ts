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
// Per-file `fs.watch` also dies when an editor rename-replaces the file (vim,
// Neovim, atomic-save patterns): the original inode is gone and the watcher
// stops firing. We accept that as v1 behavior; the stat-based "exists now →
// change" classification still produces correct events while the watcher lives.

export type WatchEvent = {
	type: "change" | "add" | "unlink";
	path: string; // absolute
};

// Trailing-debounce window (ms). fs.watch emits duplicate/rapid events for a
// single logical change; we coalesce per-path and emit once the dust settles,
// re-stat'ing at that point so the final event reflects the post-change state.
const DEBOUNCE_MS = 80;

function exists(path: string): boolean {
	try {
		statSync(path);
		return true;
	} catch {
		return false;
	}
}

export function createWatcher(
	opts: { files: string[]; dirs: string[]; recursive: boolean },
	onEvent: (e: WatchEvent) => void,
): { close(): void; add(more: { files: string[]; dirs: string[] }): void } {
	const watchers: FSWatcher[] = [];
	const timers = new Map<string, ReturnType<typeof setTimeout>>();
	// Paths we currently believe exist, used to distinguish add vs change for
	// directory events (a path we've never seen before that now exists is an add).
	const known = new Set<string>();
	// Absolute paths for which an fs.watch handle is already installed. Distinct
	// from `known` (which tracks "currently exists" and is mutated on unlink): this
	// set tracks "did we attach a handle", so repeated add() of the same path on
	// the long-lived daemon does not stack duplicate handles/timers.
	const watchedAbs = new Set<string>();

	const schedule = (path: string): void => {
		const existing = timers.get(path);
		if (existing) clearTimeout(existing);
		timers.set(
			path,
			setTimeout(() => {
				timers.delete(path);
				const here = exists(path);
				if (here) {
					const type = known.has(path) ? "change" : "add";
					known.add(path);
					onEvent({ type, path });
				} else if (known.delete(path)) {
					// Was known, now gone → unlink. (If never known, ignore: a transient
					// temp file the editor created and removed.)
					onEvent({ type: "unlink", path });
				}
			}, DEBOUNCE_MS),
		);
	};

	const watchFile = (file: string): void => {
		const abs = resolve(file);
		known.add(abs);
		// Skip if already watched: repeated `clv <samefile>` POSTs would otherwise
		// stack duplicate fs.watch handles on the long-lived daemon.
		if (watchedAbs.has(abs)) return;
		try {
			watchers.push(watch(abs, () => schedule(abs)));
			watchedAbs.add(abs);
		} catch {
			// File vanished before we could watch it; ignore.
		}
	};

	const watchDir = (dir: string): void => {
		const absDir = resolve(dir);
		if (watchedAbs.has(absDir)) return;
		try {
			watchers.push(
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
			for (const w of watchers) w.close();
			watchers.length = 0;
			watchedAbs.clear();
		},
	};
}
