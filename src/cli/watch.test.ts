import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createWatcher, type WatchEvent } from "./watch";

// FSEvents does not begin delivering events the instant fs.watch returns; give
// the watch a brief moment to attach before the first write or the first
// event can be missed entirely.
const SETTLE_MS = 150;

// fs.watch on macOS (FSEvents) has noticeable latency on top of the 80ms
// debounce, so we poll generously instead of using fixed sleeps.
async function waitFor<T>(predicate: () => T | undefined, timeoutMs = 5000): Promise<T> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const v = predicate();
		if (v !== undefined) return v;
		await Bun.sleep(25);
	}
	throw new Error("waitFor: timed out");
}

async function waitForWithEventLog<T>(
	predicate: () => T | undefined,
	events: WatchEvent[],
	timeoutMs: number,
): Promise<T> {
	try {
		return await waitFor(predicate, timeoutMs);
	} catch (e) {
		console.error(
			"events at failure:",
			events.map((ev) => `${ev.type}:${ev.path}`),
		);
		throw e;
	}
}

let dir: string;
let watcher: { close(): void; add(more: { files: string[]; dirs: string[] }): void } | undefined;

afterEach(async () => {
	watcher?.close();
	watcher = undefined;
	if (dir) await rm(dir, { recursive: true, force: true });
});

describe("createWatcher — directory events", () => {
	test("emits a single add, then change, then unlink for a .md file", async () => {
		dir = mkdtempSync(join(tmpdir(), "clv-watch-"));
		const events: WatchEvent[] = [];
		watcher = createWatcher({ files: [], dirs: [dir], recursive: false }, (e) => events.push(e));
		await Bun.sleep(SETTLE_MS);

		const file = join(dir, "note.md");

		// add
		await Bun.write(file, "# one");
		await waitFor(() => events.find((e) => e.type === "add" && e.path === file));
		// Debounce should coalesce the duplicate fs.watch events into one add.
		await Bun.sleep(200);
		expect(events.filter((e) => e.type === "add" && e.path === file)).toHaveLength(1);

		// change
		const before = events.length;
		await Bun.write(file, "# two");
		await waitFor(() => events.slice(before).find((e) => e.type === "change" && e.path === file));

		// unlink
		await rm(file);
		await waitFor(() => events.find((e) => e.type === "unlink" && e.path === file));
	});

	test("ignores non-markdown files", async () => {
		dir = mkdtempSync(join(tmpdir(), "clv-watch-"));
		const events: WatchEvent[] = [];
		watcher = createWatcher({ files: [], dirs: [dir], recursive: false }, (e) => events.push(e));
		await Bun.sleep(SETTLE_MS);

		await Bun.write(join(dir, "data.txt"), "ignored");
		await Bun.write(join(dir, "real.md"), "# real");

		// The .md add proves the watcher is live; the .txt must not appear at all.
		await waitFor(() => events.find((e) => e.path === join(dir, "real.md")));
		await Bun.sleep(200);
		expect(events.some((e) => e.path === join(dir, "data.txt"))).toBe(false);
	});
});

describe("createWatcher — directly watched file", () => {
	test("emits change when a directly watched file is modified", async () => {
		dir = mkdtempSync(join(tmpdir(), "clv-watch-"));
		const file = join(dir, "watched.md");
		await Bun.write(file, "# initial");

		const events: WatchEvent[] = [];
		watcher = createWatcher({ files: [file], dirs: [], recursive: false }, (e) => events.push(e));
		await Bun.sleep(SETTLE_MS);

		await Bun.write(file, "# modified");
		await waitFor(() => events.find((e) => e.type === "change" && e.path === file));
	});

	// Regression guard for the atomic-save inode swap. A per-file fs.watch binds to
	// the file's inode; an editor "atomic save" writes a temp file then rename()s it
	// over the target, swapping the inode. The ORIGINAL handle then goes silent
	// forever, so on the old code the watcher would be dead after the first swap and
	// no further change events would arrive. The new code re-attaches a fresh watch
	// after a `rename` (see REWATCH_MS in watch.ts). We MUST use node:fs rename here
	// rather than Bun.write: Bun.write truncates in place and keeps the inode, so it
	// would never exercise the rewatch path. The key assertion is the SECOND edit:
	// it only fires if the watcher survived the first inode swap.
	test("keeps emitting change across an atomic-save inode swap (rename replace)", async () => {
		const waitMs = 15000;
		dir = mkdtempSync(join(tmpdir(), "clv-watch-"));
		const file = join(dir, "watched.md");
		await Bun.write(file, "# initial");

		const events: WatchEvent[] = [];
		watcher = createWatcher({ files: [file], dirs: [], recursive: false }, (e) => events.push(e));
		await Bun.sleep(SETTLE_MS);

		// First atomic save: write a sibling temp file, then rename it over the
		// target. This swaps the inode exactly like vim/Neovim/formatters do.
		const tmp1 = join(dir, "watched.md.tmp1");
		await Bun.write(tmp1, "# first save");
		fs.renameSync(tmp1, file);
		await waitForWithEventLog(() => events.find((e) => e.type === "change" && e.path === file), events, waitMs);

		// A single atomic rename produces more than one change on the new code (the
		// debounced `schedule` plus the rewatch's own `schedule` after re-attaching).
		// Drain those before capturing the baseline so the next observed change is
		// unambiguously caused by the SECOND rename, not residual events from the
		// first one.
		await Bun.sleep(300);

		// THE KEY ASSERTION: after the inode swap the watcher must still be live.
		// Perform a SECOND atomic-save replace and require another change event.
		// On the old (pre-rewatch) code this event would never arrive because the
		// original handle was bound to the now-discarded inode.
		const before = events.length;
		const tmp2 = join(dir, "watched.md.tmp2");
		await Bun.write(tmp2, "# second save");
		fs.renameSync(tmp2, file);
		await waitForWithEventLog(
			() => events.slice(before).find((e) => e.type === "change" && e.path === file),
			events,
			waitMs,
		);
	}, 30000);
});

describe("createWatcher — add() deduplication (no fs.watch handle leak)", () => {
	// Count real fs.watch invocations: re-adding an already-watched path must
	// attach no new handle. This directly targets the leak (per-path timer/handle
	// stacking on the long-lived daemon) rather than relying on the debounce.
	test("re-adding an already-watched file attaches no new fs.watch handle", async () => {
		dir = mkdtempSync(join(tmpdir(), "clv-watch-"));
		const file = join(dir, "dup.md");
		await Bun.write(file, "# initial");

		const spy = spyOn(fs, "watch");
		try {
			watcher = createWatcher({ files: [file], dirs: [], recursive: false }, () => {});
			expect(spy).toHaveBeenCalledTimes(1);
			watcher.add({ files: [file], dirs: [] });
			watcher.add({ files: [file], dirs: [] });
			expect(spy).toHaveBeenCalledTimes(1);
		} finally {
			spy.mockRestore();
		}
	});

	test("re-adding an already-watched dir attaches no new fs.watch handle", async () => {
		dir = mkdtempSync(join(tmpdir(), "clv-watch-"));

		const spy = spyOn(fs, "watch");
		try {
			watcher = createWatcher({ files: [], dirs: [dir], recursive: false }, () => {});
			expect(spy).toHaveBeenCalledTimes(1);
			watcher.add({ files: [], dirs: [dir] });
			watcher.add({ files: [], dirs: [dir] });
			expect(spy).toHaveBeenCalledTimes(1);
		} finally {
			spy.mockRestore();
		}
	});
});
