import type { FileEntry } from "@shared/types";
import { describe, expect, test } from "bun:test";

import { buildFileTree, displayLabel, filterFiles, type TreeNode } from "./fileTree";

function entry(over: Partial<FileEntry> & { id: string; path: string }): FileEntry {
	return {
		displayName: over.path.split("/").pop() ?? over.id,
		title: over.title ?? "Untitled",
		...over,
	};
}

// Flatten a tree into "path" strings (dirs end with "/") for easy assertions.
function flatten(nodes: TreeNode[], prefix = ""): string[] {
	const out: string[] = [];
	for (const n of nodes) {
		if (n.kind === "dir") {
			const here = `${prefix}${n.name}/`;
			out.push(here);
			out.push(...flatten(n.children, here));
		} else {
			out.push(`${prefix}${n.name}`);
		}
	}
	return out;
}

describe("buildFileTree", () => {
	test("trims the longest common directory prefix", () => {
		const files = [
			entry({ id: "a", path: "/home/user/proj/docs/a.md" }),
			entry({ id: "b", path: "/home/user/proj/docs/b.md" }),
		];
		const tree = buildFileTree(files);
		// Common prefix /home/user/proj/docs is trimmed → both files at the root.
		expect(flatten(tree)).toEqual(["a.md", "b.md"]);
	});

	test("nests files under their differing subdirectories", () => {
		const files = [
			entry({ id: "a", path: "proj/src/a.md" }),
			entry({ id: "b", path: "proj/src/sub/b.md" }),
			entry({ id: "c", path: "proj/docs/c.md" }),
		];
		const tree = buildFileTree(files);
		// Common prefix "proj" trimmed; dirs sort before files, alphabetically.
		expect(flatten(tree)).toEqual(["docs/", "docs/c.md", "src/", "src/sub/", "src/sub/b.md", "src/a.md"]);
	});

	test("compares on segments, not characters (no false /a/b share)", () => {
		const files = [entry({ id: "x", path: "/a/bb/x.md" }), entry({ id: "y", path: "/a/b/y.md" })];
		const tree = buildFileTree(files);
		// Only "/a" is shared (segment-wise); "bb" and "b" must stay distinct dirs.
		expect(flatten(tree)).toEqual(["b/", "b/y.md", "bb/", "bb/x.md"]);
	});

	test("single file → no spurious nesting", () => {
		const tree = buildFileTree([entry({ id: "a", path: "deep/nested/only.md" })]);
		// Whole directory portion is the common prefix → just the file remains.
		expect(flatten(tree)).toEqual(["only.md"]);
	});

	test("Windows backslash paths nest correctly (not a flat list)", () => {
		const files = [
			entry({ id: "a", displayName: "a.md", path: "C:\\proj\\src\\a.md" }),
			entry({ id: "b", displayName: "b.md", path: "C:\\proj\\src\\sub\\b.md" }),
			entry({ id: "c", displayName: "c.md", path: "C:\\proj\\docs\\c.md" }),
		];
		const tree = buildFileTree(files);
		// Common prefix "C:/proj" trimmed; backslashes split into segments so the
		// tree nests just like the POSIX case (dirs first, alphabetical).
		expect(flatten(tree)).toEqual(["docs/", "docs/c.md", "src/", "src/sub/", "src/sub/b.md", "src/a.md"]);
	});

	test("empty input → empty tree", () => {
		expect(buildFileTree([])).toEqual([]);
	});
});

describe("filterFiles", () => {
	const files = [
		entry({ id: "1", path: "review.md", title: "PR Review" }),
		entry({ id: "2", path: "Notes.md", title: "Design doc" }),
	];

	test("case-insensitive match on displayName", () => {
		expect(filterFiles(files, "REVIEW").map((f) => f.id)).toEqual(["1"]);
	});

	test("case-insensitive match on title", () => {
		expect(filterFiles(files, "design").map((f) => f.id)).toEqual(["2"]);
	});

	test("empty/whitespace query returns all", () => {
		expect(filterFiles(files, "   ").length).toBe(2);
	});

	test("no match returns empty", () => {
		expect(filterFiles(files, "zzz")).toEqual([]);
	});
});

describe("displayLabel", () => {
	const e = entry({ id: "1", path: "review.md", title: "PR Review" });

	test("name mode uses displayName", () => {
		expect(displayLabel(e, "name")).toBe("review.md");
	});

	test("title mode uses title", () => {
		expect(displayLabel(e, "title")).toBe("PR Review");
	});

	test("title mode falls back to displayName when title is empty", () => {
		const blank = entry({ id: "2", path: "x.md", title: "" });
		expect(displayLabel(blank, "title")).toBe("x.md");
	});
});
