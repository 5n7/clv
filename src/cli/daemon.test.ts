import type { FileEntry } from "@shared/types";
import { VERSION } from "@shared/version";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { decideDaemonAction, decideShutdownAction, findOrSpawnDaemon, probeStatus } from "./daemon";
import { isPidAlive, readState } from "./state";

// Integration: drive the SOURCE CLI (src/cli/index.ts) as a subprocess so the
// daemon's re-exec of `Bun.argv[1]` points at the CLI (in this test process
// Bun.argv[1] is the test runner). Each test gets an isolated CLV_STATE_DIR and
// a high random port; env is inherited so CLV_STATE_DIR reaches the CLI parent
// AND the detached daemon it spawns.

const CLI = resolve(import.meta.dir, "index.ts");
const EXAMPLE = resolve(import.meta.dir, "..", "..", "examples", "review.md");

let dir: string;
let port: number;
let prevEnv: string | undefined;

function randomPort(): number {
	return 30000 + Math.floor(Math.random() * 10000);
}

// Run the CLI once with CLV_STATE_DIR pointed at the test's temp dir; resolves
// with { code, stdout } after the parent exits. `--no-open` keeps the browser
// out of the test.
async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
	// Bun.spawn inherits a SNAPSHOT of env from process start, not the live
	// process.env we mutated in beforeEach — so pass env explicitly (MERGED with
	// process.env, not replacing it) so CLV_STATE_DIR reaches the CLI parent AND
	// the detached daemon it spawns (which itself omits `env`, inheriting this).
	const proc = Bun.spawn([process.execPath, CLI, ...args], {
		env: { ...process.env, CLV_STATE_DIR: dir },
		stdout: "pipe",
		stderr: "pipe",
	});
	const code = await proc.exited;
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	return { code, stdout, stderr };
}

async function waitUntilUnreachable(p: number, timeoutMs = 3000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (!(await probeStatus(p, 300))) return;
		await Bun.sleep(50);
	}
}

beforeEach(() => {
	prevEnv = process.env.CLV_STATE_DIR;
	dir = mkdtempSync(join(tmpdir(), "clv-daemon-"));
	port = randomPort();
	// Set in THIS process too so readState()/probeStatus helpers resolve the same
	// daemon.json the spawned CLI/daemon write (env is inherited by the spawn).
	process.env.CLV_STATE_DIR = dir;
});

afterEach(async () => {
	// Kill any daemon this test left running, even on assertion failure.
	const st = readState();
	if (st?.pid && isPidAlive(st.pid)) {
		try {
			process.kill(st.pid, "SIGTERM");
		} catch {
			// already gone
		}
	}
	await Bun.sleep(100);
	if (prevEnv === undefined) delete process.env.CLV_STATE_DIR;
	else process.env.CLV_STATE_DIR = prevEnv;
	await rm(dir, { recursive: true, force: true });
});

describe("daemon lifecycle (CLI integration)", () => {
	test("first invocation spawns a detached daemon; state + /api/status are live", async () => {
		const { code, stdout } = await runCli([EXAMPLE, "--port", String(port), "--no-open"]);
		expect(code).toBe(0);
		expect(stdout).toContain("?file=");

		const st = readState();
		expect(st).toBeDefined();
		const status = await probeStatus(st!.port, 1000);
		expect(status?.clv).toBe(true);
		expect(status?.pid).toBe(st!.pid);
	}, 15000);

	test("a second invocation CONNECTS — same daemon pid, no respawn", async () => {
		await runCli([EXAMPLE, "--port", String(port), "--no-open"]);
		const pid1 = readState()!.pid;

		await runCli([EXAMPLE, "--port", String(port), "--no-open"]);
		const pid2 = readState()!.pid;

		expect(pid2).toBe(pid1);
		expect(isPidAlive(pid2)).toBe(true);
	}, 15000);

	test("status reports the running daemon", async () => {
		await runCli([EXAMPLE, "--port", String(port), "--no-open"]);
		const { stdout } = await runCli(["status", "--port", String(port)]);
		expect(stdout).toContain("daemon running");
		expect(stdout).toContain(`port ${readState()!.port}`);
	}, 15000);

	test("shutdown stops the daemon and clears state", async () => {
		await runCli([EXAMPLE, "--port", String(port), "--no-open"]);
		const livePort = readState()!.port;

		const { stdout } = await runCli(["shutdown", "--port", String(port)]);
		expect(stdout).toContain("daemon stopped");

		await waitUntilUnreachable(livePort);
		expect(await probeStatus(livePort, 300)).toBeUndefined();
		expect(readState()).toBeUndefined();
	}, 15000);

	test("status after shutdown reports no daemon", async () => {
		await runCli([EXAMPLE, "--port", String(port), "--no-open"]);
		await runCli(["shutdown", "--port", String(port)]);
		const { stdout } = await runCli(["status", "--port", String(port)]);
		expect(stdout).toContain("no daemon running");
	}, 15000);

	test("a new daemon restores the previously-registered session after shutdown", async () => {
		// Register a file with a first daemon, then shut it down. The session.json
		// must survive shutdown so a fresh daemon restores it.
		const note = join(dir, "note.md");
		writeFileSync(note, "# Note\n");

		await runCli([note, "--port", String(port), "--no-open"]);
		await runCli(["shutdown", "--port", String(port)]);
		await waitUntilUnreachable(readState()?.port ?? port);

		// session.json persists past shutdown (only daemon.json is cleared).
		expect(existsSync(join(dir, "session.json"))).toBe(true);

		// Start a NEW daemon WITHOUT re-registering note.md; it should restore it.
		const { code, stdout } = await runCli(["status", "--port", String(port)]);
		// `status` alone won't spawn a daemon, so spawn one via a separate path that
		// also exists, then assert note.md is present in the restored list.
		expect(code).toBe(0);
		expect(stdout).toContain("no daemon running");

		const other = join(dir, "other.md");
		writeFileSync(other, "# Other\n");
		await runCli([other, "--port", String(port), "--no-open"]);

		const livePort = readState()!.port;
		const res = await fetch(`http://localhost:${livePort}/api/files`);
		const list = (await res.json()) as Array<{ displayName: string }>;
		const names = list.map((e) => e.displayName).sort();
		// Restored note.md merged with the freshly-added other.md (mo-style merge).
		expect(names).toEqual(["note.md", "other.md"]);
	}, 20000);

	test("session restore round-trips per-file groups AND migrates a legacy bare-string entry", async () => {
		// Pre-seed session.json with a MIXED shape: one legacy bare string (must
		// migrate to group "default") and one new {path, group} object (must keep its
		// group). A fresh daemon restores both; /api/files reflects the groups.
		const legacy = join(dir, "legacy.md");
		const grouped = join(dir, "grouped.md");
		writeFileSync(legacy, "# Legacy\n");
		writeFileSync(grouped, "# Grouped\n");
		writeFileSync(join(dir, "session.json"), JSON.stringify({ files: [legacy, { path: grouped, group: "5n7/clv" }] }));

		// Spawn a daemon by registering an unrelated existing file; restore merges in
		// legacy.md + grouped.md (no daemon was running, so this is a fresh start).
		const trigger = join(dir, "trigger.md");
		writeFileSync(trigger, "# Trigger\n");
		await runCli([trigger, "--port", String(port), "--no-open"]);

		const livePort = readState()!.port;
		const res = await fetch(`http://localhost:${livePort}/api/files`);
		const list = (await res.json()) as Array<{ displayName: string; group: string }>;
		const byName = new Map(list.map((e) => [e.displayName, e.group]));
		expect(byName.get("legacy.md")).toBe("default");
		expect(byName.get("grouped.md")).toBe("5n7/clv");
	}, 20000);

	test("a stale state file (dead pid) is recovered by re-spawning cleanly", async () => {
		// Pre-seed a zombie state: a dead pid, nothing listening on the port.
		writeFileSync(
			join(dir, "daemon.json"),
			JSON.stringify({ port, pid: 2_000_000_000, version: "0.1.0", startedAt: Date.now() }),
		);

		const { code } = await runCli([EXAMPLE, "--port", String(port), "--no-open"]);
		expect(code).toBe(0);

		const st = readState();
		expect(st).toBeDefined();
		expect(st!.pid).not.toBe(2_000_000_000);
		const status = await probeStatus(st!.port, 1000);
		expect(status?.clv).toBe(true);
	}, 15000);

	test("/api/status reports the daemon's fixed theme and watch", async () => {
		await runCli([EXAMPLE, "--port", String(port), "--theme", "dark", "--no-watch", "--no-open"]);
		const status = await probeStatus(readState()!.port, 1000);
		expect(status?.theme).toBe("dark");
		expect(status?.watch).toBe(false);
	}, 15000);

	test("a connect with a different --theme keeps the daemon's theme; doc.theme stays dark + notice printed", async () => {
		// First invocation spawns the daemon with theme=dark.
		await runCli([EXAMPLE, "--port", String(port), "--theme", "dark", "--no-open"]);
		const livePort = readState()!.port;

		// Second invocation connects with theme=light: must NOT re-theme the daemon.
		const second = await runCli([EXAMPLE, "--port", String(port), "--theme", "light", "--no-open"]);
		// The connect-mismatch notice goes to stderr.
		expect(second.stderr).toContain('daemon already running with theme="dark"');
		expect(second.stderr).toContain('--theme "light" ignored');

		// /api/status still reports the original theme.
		const status = await probeStatus(livePort, 1000);
		expect(status?.theme).toBe("dark");

		// The served document is themed with the daemon's (first) theme, not "light".
		const list = (await (await fetch(`http://localhost:${livePort}/api/files`)).json()) as FileEntry[];
		expect(list.length).toBeGreaterThan(0);
		const doc = (await (
			await fetch(`http://localhost:${livePort}/api/files/${encodeURIComponent(list[0]!.id)}`)
		).json()) as { theme: string };
		expect(doc.theme).toBe("dark");
	}, 20000);

	test("a connect with a MATCHING --theme prints no mismatch notice", async () => {
		await runCli([EXAMPLE, "--port", String(port), "--theme", "dark", "--no-open"]);
		const second = await runCli([EXAMPLE, "--port", String(port), "--theme", "dark", "--no-open"]);
		expect(second.stderr).not.toContain("ignored");
	}, 20000);

	test("a connect with a different --watch keeps the daemon's watch; notice printed", async () => {
		// First invocation spawns the daemon with watch=false (--no-watch explicit).
		await runCli([EXAMPLE, "--port", String(port), "--no-watch", "--no-open"]);
		const livePort = readState()!.port;

		// Second invocation connects with --watch (watch=true): must NOT re-arm the daemon.
		const second = await runCli([EXAMPLE, "--port", String(port), "--watch", "--no-open"]);
		// The connect-mismatch notice goes to stderr.
		expect(second.stderr).toContain("daemon already running with watch=false");
		expect(second.stderr).toContain("--watch ignored");

		// /api/status still reports the daemon's original (fixed) watch setting.
		const status = await probeStatus(livePort, 1000);
		expect(status?.watch).toBe(false);
	}, 20000);

	test("a connect with a MATCHING --watch prints no mismatch notice", async () => {
		await runCli([EXAMPLE, "--port", String(port), "--no-watch", "--no-open"]);
		const second = await runCli([EXAMPLE, "--port", String(port), "--no-watch", "--no-open"]);
		expect(second.stderr).not.toContain("ignored");
	}, 20000);

	test("findOrSpawnDaemon returns spawned:false (with daemon status) when connecting to a running daemon", async () => {
		// Spawn a real daemon (theme=dark) via the CLI subprocess; CLV_STATE_DIR is
		// shared, so readState() in-process resolves it. A direct in-process call to
		// findOrSpawnDaemon then takes the CONNECT branch (it never spawns, so the
		// test-runner's Bun.argv[1] is irrelevant here).
		await runCli([EXAMPLE, "--port", String(port), "--theme", "dark", "--no-watch", "--no-open"]);

		const res = await findOrSpawnDaemon({ port, theme: "light", watch: true });
		expect(res.spawned).toBe(false);
		expect(res.status?.theme).toBe("dark");
		expect(res.status?.watch).toBe(false);
		expect(res.port).toBe(readState()!.port);
	}, 15000);
});

describe("decideDaemonAction (pure decision)", () => {
	const alwaysAlive = () => true;
	const neverAlive = () => false;

	test("no state → spawn", () => {
		expect(decideDaemonAction(undefined, undefined, alwaysAlive)).toBe("spawn");
	});

	test("state but unreachable (zombie) → clear-then-respawn", () => {
		const state = { port: 1234, pid: 100, version: VERSION };
		expect(decideDaemonAction(state, undefined, alwaysAlive)).toBe("clear-then-respawn");
	});

	test("reachable, same version, same pid, alive → connect", () => {
		const state = { port: 1234, pid: 100, version: VERSION };
		const status = { clv: true, version: VERSION, port: 1234, pid: 100 };
		expect(decideDaemonAction(state, status, alwaysAlive)).toBe("connect");
	});

	test("reachable, same pid alive, version MISMATCH → shutdown-then-respawn", () => {
		const state = { port: 1234, pid: 100, version: "0.0.1" };
		const status = { clv: true, version: "0.0.1", port: 1234, pid: 100 };
		expect(decideDaemonAction(state, status, alwaysAlive)).toBe("shutdown-then-respawn");
	});

	test("reachable but a DIFFERENT pid holds the port → clear-then-respawn (don't shut down the stranger)", () => {
		// state pid is alive (e.g. the current process) but the daemon answering on
		// the port reports a different pid → it's not ours; clear+respawn, not shutdown.
		const state = { port: 1234, pid: process.pid, version: VERSION };
		const status = { clv: true, version: VERSION, port: 1234, pid: process.pid + 1 };
		expect(decideDaemonAction(state, status, isPidAlive)).toBe("clear-then-respawn");
		// And specifically NOT shutdown-then-respawn even on a version mismatch.
		const statusMismatch = { clv: true, version: "0.0.1", port: 1234, pid: process.pid + 1 };
		expect(decideDaemonAction(state, statusMismatch, isPidAlive)).toBe("clear-then-respawn");
	});

	test("reachable, same pid reported, but state pid is dead → clear-then-respawn", () => {
		const state = { port: 1234, pid: 100, version: VERSION };
		const status = { clv: true, version: VERSION, port: 1234, pid: 100 };
		expect(decideDaemonAction(state, status, neverAlive)).toBe("clear-then-respawn");
	});
});

describe("decideShutdownAction (pure decision)", () => {
	test("unreachable (no status) → no-op", () => {
		expect(decideShutdownAction({ pid: 100 }, undefined)).toBe("no-op");
	});

	test("our daemon (matching pid) → stop", () => {
		expect(decideShutdownAction({ pid: 100 }, { clv: true, pid: 100 })).toBe("stop");
	});

	test("a stranger holds the port (pid mismatch) → no-op", () => {
		expect(decideShutdownAction({ pid: 100 }, { clv: true, pid: 101 })).toBe("no-op");
	});

	test("no ownership record → stop the explicitly targeted port", () => {
		expect(decideShutdownAction(undefined, { clv: true, pid: 101 })).toBe("stop");
	});
});
