import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	clearSession,
	clearState,
	type DaemonState,
	isPidAlive,
	readSession,
	readState,
	sessionFilePath,
	stateFilePath,
	writeSession,
	writeState,
} from "./state";

let dir: string;
let prevEnv: string | undefined;

beforeEach(() => {
	prevEnv = process.env.CLV_STATE_DIR;
	dir = mkdtempSync(join(tmpdir(), "clv-state-"));
	process.env.CLV_STATE_DIR = dir;
});

afterEach(async () => {
	if (prevEnv === undefined) delete process.env.CLV_STATE_DIR;
	else process.env.CLV_STATE_DIR = prevEnv;
	await rm(dir, { recursive: true, force: true });
});

describe("stateFilePath", () => {
	test("honors CLV_STATE_DIR and ends with daemon.json", () => {
		expect(stateFilePath()).toBe(join(dir, "daemon.json"));
	});
});

describe("read/write/clear round-trip", () => {
	const sample: DaemonState = { port: 7421, pid: 12345, version: "0.1.0", startedAt: 1700000000000 };

	test("writeState then readState returns the same state (mkdir -p the dir)", () => {
		writeState(sample);
		expect(readState()).toEqual(sample);
	});

	test("clearState removes the file and readState returns undefined", () => {
		writeState(sample);
		expect(existsSync(stateFilePath())).toBe(true);
		clearState();
		expect(existsSync(stateFilePath())).toBe(false);
		expect(readState()).toBeUndefined();
	});

	test("clearState on a missing file is a no-op (ignores ENOENT)", () => {
		expect(() => clearState()).not.toThrow();
	});
});

describe("readState robustness", () => {
	test("returns undefined when the file is absent", () => {
		expect(readState()).toBeUndefined();
	});

	test("returns undefined for unparseable garbage", () => {
		writeFileSync(stateFilePath(), "{not json");
		expect(readState()).toBeUndefined();
	});

	test("returns undefined for JSON missing required fields", () => {
		writeFileSync(stateFilePath(), JSON.stringify({ port: 7421 }));
		expect(readState()).toBeUndefined();
	});
});

describe("session round-trip", () => {
	test("sessionFilePath honors CLV_STATE_DIR and ends with session.json", () => {
		expect(sessionFilePath()).toBe(join(dir, "session.json"));
	});

	test("writeSession then readSession round-trips the new {path, group} shape", () => {
		const sample = {
			files: [
				{ path: "/a/x.md", group: "5n7/clv" },
				{ path: "/b/y.md", group: "default" },
			],
		};
		writeSession(sample);
		expect(readSession()).toEqual(sample);
	});

	test("MIGRATION: a legacy {files: string[]} session is read as {path, group:'default'}", () => {
		// Old daemons wrote bare path strings; readSession must migrate each to a
		// {path, group} object so the in-memory shape is uniform after restore.
		writeFileSync(sessionFilePath(), JSON.stringify({ files: ["/a/x.md", "/b/y.md"] }));
		expect(readSession()).toEqual({
			files: [
				{ path: "/a/x.md", group: "default" },
				{ path: "/b/y.md", group: "default" },
			],
		});
	});

	test("MIGRATION: a mixed legacy/new array migrates the bare strings only", () => {
		// During the migration window a session may carry both shapes; each element
		// is normalized independently.
		writeFileSync(sessionFilePath(), JSON.stringify({ files: ["/a/x.md", { path: "/b/y.md", group: "design" }] }));
		expect(readSession()).toEqual({
			files: [
				{ path: "/a/x.md", group: "default" },
				{ path: "/b/y.md", group: "design" },
			],
		});
	});

	test("clearSession removes the file and readSession returns undefined", () => {
		writeSession({ files: [{ path: "/a/x.md", group: "default" }] });
		expect(existsSync(sessionFilePath())).toBe(true);
		clearSession();
		expect(existsSync(sessionFilePath())).toBe(false);
		expect(readSession()).toBeUndefined();
	});

	test("readSession returns undefined when absent", () => {
		expect(readSession()).toBeUndefined();
	});

	test("readSession returns undefined for unparseable garbage", () => {
		writeFileSync(sessionFilePath(), "{not json");
		expect(readSession()).toBeUndefined();
	});

	test("readSession returns undefined when files holds neither strings nor {path, group}", () => {
		writeFileSync(sessionFilePath(), JSON.stringify({ files: [1, 2, 3] }));
		expect(readSession()).toBeUndefined();
	});

	test("readSession returns undefined when a {path, group} element is malformed", () => {
		writeFileSync(sessionFilePath(), JSON.stringify({ files: [{ path: "/a/x.md" }] }));
		expect(readSession()).toBeUndefined();
	});
});

describe("isPidAlive", () => {
	test("true for the current process", () => {
		expect(isPidAlive(process.pid)).toBe(true);
	});

	test("false for an almost-certainly-dead pid", () => {
		expect(isPidAlive(2_000_000_000)).toBe(false);
	});
});
