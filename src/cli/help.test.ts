import { describe, expect, test } from "bun:test";

import { printHelp } from "./args";

// Capture everything printHelp() emits. cac's outputHelp() writes via console.info;
// console.log and process.stdout.write are stubbed too in case a cac version routes
// through them. All are replaced with capture-only functions (no pass-through, so
// nothing leaks to the real test output) and restored in `finally`.
function captureHelp(): string {
	const origInfo = console.info;
	const origLog = console.log;
	const origWrite = process.stdout.write.bind(process.stdout);
	let captured = "";
	const sink = (...args: unknown[]) => {
		captured += `${args.join(" ")}\n`;
	};
	console.info = sink;
	console.log = sink;
	process.stdout.write = ((chunk: unknown) => {
		captured += String(chunk);
		return true;
	}) as typeof process.stdout.write;
	try {
		printHelp();
	} finally {
		console.info = origInfo;
		console.log = origLog;
		process.stdout.write = origWrite;
	}
	return captured;
}

describe("printHelp — auto-generated cac help", () => {
	test("includes the usage, commands, and key options", () => {
		const out = captureHelp();
		expect(out).toContain("Usage:");
		expect(out).toContain("Commands:");
		expect(out).toContain("doc [block]");
		// The daemon-control verbs are listed as commands (not options).
		expect(out).toContain("status");
		expect(out).toContain("shutdown");
		expect(out).toContain("--port");
		expect(out).toContain("-h, --help");
	});

	test("does not leak the retired --status / --shutdown option flags", () => {
		// Daemon control moved from flags to verb subcommands; the old `--status` /
		// `--shutdown` flags are gone. Help must not advertise them as options — this
		// pins the migration and guards against a stale flag re-appearing. The bare
		// verbs (`status` / `shutdown`) are still expected; only the `--`-prefixed
		// option forms must be absent (and they never appear as substrings here).
		const out = captureHelp();
		expect(out).not.toContain("--status");
		expect(out).not.toContain("--shutdown");
	});

	test("does not leak the hidden --__daemon flag", () => {
		// `--__daemon` is intentionally unregistered so it stays out of help while
		// still being parsed. This guards against a regression that registers it.
		expect(captureHelp()).not.toContain("__daemon");
	});
});
