import { describe, expect, test } from "bun:test";

import { fileQuery, parseFileId, urlSyncOnFilesChanged } from "./router";

describe("parseFileId", () => {
	test("reads the file id from a query string", () => {
		expect(parseFileId("?file=abc123")).toBe("abc123");
	});

	test("works without a leading question mark", () => {
		expect(parseFileId("file=abc123")).toBe("abc123");
	});

	test("decodes percent-encoded ids", () => {
		expect(parseFileId("?file=a%2Fb")).toBe("a/b");
	});

	test("picks the file param among others", () => {
		expect(parseFileId("?foo=1&file=xyz&bar=2")).toBe("xyz");
	});

	test("returns undefined when absent", () => {
		expect(parseFileId("?foo=1")).toBeUndefined();
	});

	test("returns undefined for empty search", () => {
		expect(parseFileId("")).toBeUndefined();
	});

	test("returns empty string when file= has no value (still defined)", () => {
		expect(parseFileId("?file=")).toBe("");
	});
});

describe("fileQuery", () => {
	test("builds a ?file= query for an id", () => {
		expect(fileQuery("abc123")).toBe("?file=abc123");
	});

	test("percent-encodes ids so the URL-sync fallback round-trips", () => {
		expect(fileQuery("a/b")).toBe("?file=a%2Fb");
		// Round-trips back through parseFileId (the helper navigate/replaceFileId use).
		expect(parseFileId(fileQuery("a/b"))).toBe("a/b");
	});
});

describe("urlSyncOnFilesChanged", () => {
	test("current file still present → none", () => {
		expect(urlSyncOnFilesChanged("a", [{ id: "a" }, { id: "b" }])).toEqual({ kind: "none" });
	});

	test("current file removed but others remain → clear (enables recovery via sidebar pick)", () => {
		expect(urlSyncOnFilesChanged("a", [{ id: "b" }, { id: "c" }])).toEqual({ kind: "clear" });
	});

	test("current file removed and no files remain → clear", () => {
		expect(urlSyncOnFilesChanged("a", [])).toEqual({ kind: "clear" });
	});

	test("no current file → none", () => {
		expect(urlSyncOnFilesChanged(undefined, [{ id: "a" }])).toEqual({ kind: "none" });
	});

	test("no current file and no files → none", () => {
		expect(urlSyncOnFilesChanged(undefined, [])).toEqual({ kind: "none" });
	});
});
