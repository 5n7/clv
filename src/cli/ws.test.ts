import type { Document, FileEntry } from "@shared/types";
import { describe, expect, test } from "bun:test";

import { buildDocChanged, buildFilesChanged, buildHello, serialize } from "./ws";

const DOC: Document = {
	title: "T",
	theme: "auto",
	nodes: [{ kind: "markdown", markdown: "# T" }],
};

const FILES: FileEntry[] = [{ id: "f-abc", path: "/x/a.md", displayName: "a.md", title: "A" }];

describe("ws builders", () => {
	test("buildHello returns the hello shape", () => {
		expect(buildHello("1.2.3")).toEqual({ type: "hello", version: "1.2.3" });
	});

	test("buildDocChanged returns the doc-changed shape", () => {
		expect(buildDocChanged("f-abc", DOC)).toEqual({ type: "doc-changed", fileId: "f-abc", doc: DOC });
	});

	test("buildFilesChanged returns the files-changed shape", () => {
		expect(buildFilesChanged(FILES)).toEqual({ type: "files-changed", files: FILES });
	});
});

describe("serialize", () => {
	test("round-trips each message via JSON.parse", () => {
		for (const msg of [buildHello("9.9.9"), buildDocChanged("f-1", DOC), buildFilesChanged(FILES)]) {
			expect(JSON.parse(serialize(msg))).toEqual(msg);
		}
	});
});
