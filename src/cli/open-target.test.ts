import type { FileEntry } from "@shared/types";
import { describe, expect, test } from "bun:test";
import { join, sep } from "node:path";

import { pickOpenId } from "./open-target";

function entry(path: string): FileEntry {
	return { id: `id:${path}`, path, displayName: path.split(sep).pop()!, title: path, group: "default" };
}

describe("pickOpenId", () => {
	const docs = join(sep, "home", "u", "docs");
	const inside = join(docs, "a.md");
	const other = join(sep, "home", "u", "other.md");

	test("dir arg matches a file under it", () => {
		// entries[0] is unrelated; the dir arg must still pick the file inside docs/.
		const entries = [entry(other), entry(inside)];
		expect(pickOpenId(entries, [docs])).toBe(`id:${inside}`);
	});

	test("exact file arg matches that file", () => {
		const entries = [entry(other), entry(inside)];
		expect(pickOpenId(entries, [inside])).toBe(`id:${inside}`);
	});

	test("falls back to the first entry when nothing matches", () => {
		const entries = [entry(other), entry(inside)];
		const unrelated = join(sep, "tmp", "nope");
		expect(pickOpenId(entries, [unrelated])).toBe(`id:${other}`);
	});

	test("returns undefined for an empty entry list", () => {
		expect(pickOpenId([], [docs])).toBeUndefined();
	});

	test("does not treat a sibling prefix as 'under' the dir (sep boundary)", () => {
		// `/home/u/docs-archive/x.md` must NOT match the arg `/home/u/docs`; the
		// real file under docs/ must win even though the sibling shares the prefix.
		const sibling = join(sep, "home", "u", "docs-archive", "x.md");
		const entries = [entry(sibling), entry(inside)];
		expect(pickOpenId(entries, [docs])).toBe(`id:${inside}`);
	});
});
