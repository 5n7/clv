import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createWatcher, type WatchEvent } from "./watch";

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

// FSEvents does not begin delivering events the instant fs.watch returns; give
// the watch a brief moment to attach before the first write or the first
// event can be missed entirely.
const SETTLE_MS = 150;

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
