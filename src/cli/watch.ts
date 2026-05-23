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
// Per-file `fs.watch` binds to the file's inode, so an editor that saves
// atomically (write temp file + rename over the target — vim, Neovim, many
// formatters, common on macOS) replaces the inode and the original handle goes
// silent forever. We handle this the way k1LoW/mo does: when a file watch emits
// a `rename` event we wait briefly, then `stat` the path. If the file still
// exists there, the inode was swapped by an atomic save, so we close the stale
// handle and re-attach a fresh `fs.watch` to the same path (binding to the new
// inode), then emit a change. If the path is gone, we leave it to the debounced
// `schedule` logic, which emits the `unlink`. On macOS FSEvents a plain write
// can also surface as `rename`; that is harmless — the stat check is the gate
// and re-attaching a still-live path just closes and reopens the handle.

export type WatchEvent = {
	type: "change" | "add" | "unlink";
	path: string; // absolute
};

// Trailing-debounce window (ms). fs.watch emits duplicate/rapid events for a
// single logical change; we coalesce per-path and emit once the dust settles,
// re-stat'ing at that point so the final event reflects the post-change state.
const DEBOUNCE_MS = 80;

// Delay (ms) after a `rename` event before re-stat'ing the path to decide
// whether to re-attach a fresh watch handle (atomic-save inode swap).
const REWATCH_MS = 100;

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
	// Paths we currently believe exist, used to distinguish add vs change for
	// directory events (a path we've never seen before that now exists is an add).
	const known = new Set<string>();
	// Absolute paths of watched DIRECTORIES for which a handle is already
	// installed. File dedup is handled by `fileWatchers.has(abs)` instead; this
	// set tracks directories so repeated add() of the same dir on the long-lived
	// daemon does not stack duplicate handles.
	const watchedAbs = new Set<string>();
	// Directory watchers: these never need rewatch logic, so they stay in a flat
	// array keyed only by `watchedAbs` for dedup.
	const dirWatchers: FSWatcher[] = [];
	// File watchers keyed by absolute path so an individual file's handle can be
	// replaced when an atomic save swaps the inode (see IMPLEMENTATION NOTE).
	const fileWatchers = new Map<string, FSWatcher>();
	const timers = new Map<string, ReturnType<typeof setTimeout>>();
	// Per-path timers for the delayed rename→stat→re-attach routine. Kept separate
	// from `timers` so a rename's rewatch debounce does not clobber the change
	// debounce (and vice versa).
	const rewatchTimers = new Map<string, ReturnType<typeof setTimeout>>();

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

	// Low-level attach shared by initial watch and re-attach. Sets the map entry
	// only on success, so a throw leaves no stale entry.
	const attachFileWatch = (abs: string): void => {
		try {
			fileWatchers.set(
				abs,
				watch(abs, (eventType) => {
					schedule(abs);
					if (eventType === "rename") scheduleRewatch(abs);
				}),
			);
		} catch {
			// File vanished before we could watch it; ignore.
		}
	};

	// Re-stat after a `rename` and re-attach a fresh handle if the file still
	// exists at the path (its inode was swapped by an atomic save). Debounced
	// per-path on its own timer map.
	const scheduleRewatch = (abs: string): void => {
		const existing = rewatchTimers.get(abs);
		if (existing) clearTimeout(existing);
		rewatchTimers.set(
			abs,
			setTimeout(() => {
				rewatchTimers.delete(abs);
				// The daemon may have dropped this file in the meantime.
				if (!fileWatchers.has(abs)) return;
				// Genuinely gone → leave the unlink to `schedule`'s debounce.
				if (!exists(abs)) return;
				// Inode swapped: close the stale handle and bind a fresh one.
				fileWatchers.get(abs)?.close();
				fileWatchers.delete(abs);
				attachFileWatch(abs);
				// Emit the post-rename content as a change.
				schedule(abs);
			}, REWATCH_MS),
		);
	};

	const watchFile = (file: string): void => {
		const abs = resolve(file);
		known.add(abs);
		// Skip if already watched: repeated `clv <samefile>` POSTs would otherwise
		// stack duplicate fs.watch handles on the long-lived daemon.
		if (fileWatchers.has(abs)) return;
		attachFileWatch(abs);
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
			for (const t of rewatchTimers.values()) clearTimeout(t);
			rewatchTimers.clear();
			for (const w of dirWatchers) w.close();
			dirWatchers.length = 0;
			for (const w of fileWatchers.values()) w.close();
			fileWatchers.clear();
			watchedAbs.clear();
		},
	};
}
