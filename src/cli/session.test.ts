import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expandPaths, fileIdFromPath, firstHeading, Session } from "./session";

describe("fileIdFromPath", () => {
	test("is deterministic for the same absolute path", () => {
		const a = fileIdFromPath("/abs/path/to/file.md");
		const b = fileIdFromPath("/abs/path/to/file.md");
		expect(a).toBe(b);
	});

	test("is prefixed with f- and is opaque/short", () => {
		const id = fileIdFromPath("/abs/path/to/file.md");
		expect(id).toMatch(/^f-[0-9a-f]{12}$/);
	});

	test("differs for different paths", () => {
		expect(fileIdFromPath("/a/one.md")).not.toBe(fileIdFromPath("/a/two.md"));
		expect(fileIdFromPath("/a/x.md")).not.toBe(fileIdFromPath("/b/x.md"));
	});
});

describe("firstHeading", () => {
	test("extracts the first ATX heading text", () => {
		expect(firstHeading("# Hello world\n\nbody")).toBe("Hello world");
	});

	test("returns undefined when there is no heading", () => {
		expect(firstHeading("just prose\nmore prose")).toBeUndefined();
	});

	test("trims leading whitespace inside the heading", () => {
		expect(firstHeading("#    Spaced  Title  ")).toBe("Spaced  Title");
	});

	test("strips an optional closing run of #", () => {
		expect(firstHeading("## Title ##")).toBe("Title");
	});

	test("picks the first heading when several exist", () => {
		expect(firstHeading("intro\n\n# First\n\n## Second")).toBe("First");
	});

	test("handles deeper heading levels (### …)", () => {
		expect(firstHeading("### Deep heading")).toBe("Deep heading");
	});
});

describe("expandPaths", () => {
	let dir: string;

	afterEach(async () => {
		if (dir) await rm(dir, { recursive: true, force: true });
	});

	test("collects top-level .md/.markdown files and the dir root (non-recursive)", () => {
		dir = mkdtempSync(join(tmpdir(), "clv-expand-"));
		writeFileSync(join(dir, "a.md"), "# a");
		writeFileSync(join(dir, "b.markdown"), "# b");
		writeFileSync(join(dir, "ignore.txt"), "x");
		mkdirSync(join(dir, "sub"));
		writeFileSync(join(dir, "sub", "deep.md"), "# deep");

		const { files, dirs } = expandPaths([dir], { recursive: false });
		expect(files).toEqual([join(dir, "a.md"), join(dir, "b.markdown")]);
		expect(dirs).toEqual([dir]);
	});

	test("recurses into subdirectories and records nested dir roots", () => {
		dir = mkdtempSync(join(tmpdir(), "clv-expand-"));
		writeFileSync(join(dir, "a.md"), "# a");
		mkdirSync(join(dir, "sub"));
		writeFileSync(join(dir, "sub", "deep.md"), "# deep");

		const { files, dirs } = expandPaths([dir], { recursive: true });
		expect(files).toEqual([join(dir, "a.md"), join(dir, "sub", "deep.md")]);
		expect(dirs).toEqual([dir, join(dir, "sub")]);
	});

	test("records a file input as a file with no dir root", () => {
		dir = mkdtempSync(join(tmpdir(), "clv-expand-"));
		const f = join(dir, "single.md");
		writeFileSync(f, "# single");

		const { files, dirs } = expandPaths([f], { recursive: false });
		expect(files).toEqual([f]);
		expect(dirs).toEqual([]);
	});
});

describe("Session.remove", () => {
	test("drops a file by id", () => {
		const session = new Session();
		const path = "/abs/x.md";
		session.register([path], "default");
		const id = fileIdFromPath(path);
		expect(session.has(id)).toBe(true);
		session.remove(id);
		expect(session.has(id)).toBe(false);
	});
});

describe("Session — grouping", () => {
	test("register stores the group and list() carries it", () => {
		const session = new Session();
		session.register(["/abs/x.md"], "5n7/clv");
		const entry = session.list()[0]!;
		expect(entry.group).toBe("5n7/clv");
	});

	test("last-write-wins: re-registering an existing file updates its group", () => {
		const session = new Session();
		const path = "/abs/x.md";
		session.register([path], "default");
		expect(session.list()[0]!.group).toBe("default");
		// Re-register the same path under a new group: the group updates in place.
		session.register([path], "design");
		const list = session.list();
		expect(list).toHaveLength(1);
		expect(list[0]!.group).toBe("design");
	});

	test("re-registering preserves insertion order (the file does not jump)", () => {
		const session = new Session();
		session.register(["/abs/a.md", "/abs/b.md"], "default");
		// Re-register the first file under a new group; order must stay a, b.
		session.register(["/abs/a.md"], "design");
		expect(session.list().map((e) => e.path)).toEqual(["/abs/a.md", "/abs/b.md"]);
	});
});

describe("Session.list — mtime-keyed title cache", () => {
	let dir: string;
	let spy: ReturnType<typeof spyOn<typeof fs, "readFileSync">>;

	afterEach(async () => {
		spy?.mockRestore();
		if (dir) await rm(dir, { recursive: true, force: true });
	});

	test("a second list() with no edit reuses the cache (no extra read) and keeps titles", () => {
		dir = mkdtempSync(join(tmpdir(), "clv-titlecache-"));
		const a = join(dir, "a.md");
		const b = join(dir, "b.md");
		writeFileSync(a, "# Alpha\n");
		writeFileSync(b, "# Beta\n");

		const session = new Session();
		session.register([a, b], "default");

		// First list() reads both files to derive titles.
		spy = spyOn(fs, "readFileSync");
		const first = session.list();
		expect(first.map((e) => e.title)).toEqual(["Alpha", "Beta"]);
		const readsAfterFirst = spy.mock.calls.length;
		expect(readsAfterFirst).toBe(2);

		// Second list() with unchanged files: cache hit, no further reads.
		const second = session.list();
		expect(second.map((e) => e.title)).toEqual(["Alpha", "Beta"]);
		expect(spy.mock.calls.length).toBe(readsAfterFirst);
	});

	test("an edit (mtime bump) invalidates the cache and the title updates", () => {
		dir = mkdtempSync(join(tmpdir(), "clv-titlecache-"));
		const a = join(dir, "a.md");
		// Backdate the initial mtime so the post-edit write definitely differs.
		writeFileSync(a, "# Old Title\n");
		const past = new Date(Date.now() - 10_000);
		fs.utimesSync(a, past, past);

		const session = new Session();
		session.register([a], "default");
		expect(session.list()[0]!.title).toBe("Old Title");

		// Rewrite with a fresh mtime; the cache must re-read and reflect the new heading.
		writeFileSync(a, "# New Title\n");
		expect(session.list()[0]!.title).toBe("New Title");
	});
});
