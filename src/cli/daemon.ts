import { VERSION } from "@shared/version";
import { existsSync } from "node:fs";

import { startServer } from "./serve";
import { clearState, isPidAlive, readSession, readState, writeSession, writeState } from "./state";

// mo-style background daemon: a single long-lived clv server that successive
// `clv <paths>` invocations discover and register files into. This module owns
// (a) the detached process entrypoint (`runDaemonMain`) and (b) the parent-side
// find-or-spawn logic (`findOrSpawnDaemon`).

export type DaemonTheme = "auto" | "light" | "dark";

// Probe a candidate daemon's identity endpoint. Returns the parsed body when it
// responds with a clv status payload, else undefined (unreachable / not clv).
export type DaemonStatus = {
	clv: boolean;
	version: string;
	port: number;
	pid: number;
	files: number;
	// The daemon's effective theme/watch, fixed at its start (older daemons that
	// predate these fields report undefined).
	theme?: DaemonTheme;
	watch?: boolean;
};

export async function probeStatus(port: number, timeoutMs: number): Promise<DaemonStatus | undefined> {
	try {
		const res = await fetch(`http://localhost:${port}/api/status`, {
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (!res.ok) return undefined;
		const body = (await res.json()) as {
			clv?: unknown;
			version?: unknown;
			port?: unknown;
			pid?: unknown;
			files?: unknown;
			theme?: unknown;
			watch?: unknown;
		};
		if (body.clv !== true) return undefined;
		return {
			clv: true,
			version: String(body.version ?? ""),
			port: typeof body.port === "number" ? body.port : port,
			pid: typeof body.pid === "number" ? body.pid : 0,
			files: typeof body.files === "number" ? body.files : 0,
			theme: body.theme === "auto" || body.theme === "light" || body.theme === "dark" ? body.theme : undefined,
			watch: typeof body.watch === "boolean" ? body.watch : undefined,
		};
	} catch {
		return undefined;
	}
}

// What to do with an existing (or absent) daemon. Pure decision separated from
// the IO so it can be unit-tested without races (see daemon.test.ts).
//   - connect: the state's daemon is reachable, same version, AND the SAME pid
//     the state file recorded (and that pid is alive).
//   - shutdown-then-respawn: the genuine "our old version still running" case —
//     same pid, alive, but a different version. Ask IT to step down, then respawn.
//   - clear-then-respawn: anything stale/foreign — pid mismatch (a DIFFERENT clv
//     now holds the port; never shut down a stranger), dead pid, or unreachable.
//   - spawn: no state at all.
export type DaemonAction = "connect" | "shutdown-then-respawn" | "clear-then-respawn" | "spawn";

export function decideDaemonAction(
	state: { port: number; pid: number; version: string } | undefined,
	status: { clv: boolean; version: string; port: number; pid: number } | undefined,
	pidAlive: (pid: number) => boolean,
): DaemonAction {
	if (!state) return "spawn";
	// Unreachable (zombie/stale file): nothing is actually listening.
	if (!status?.clv) return "clear-then-respawn";
	// A different process holds the port than the state recorded: treat as stale
	// and respawn — do NOT send shutdown to a daemon we don't own.
	if (status.pid !== state.pid || !pidAlive(state.pid)) return "clear-then-respawn";
	if (status.version === VERSION) return "connect";
	// Same pid, alive, but a different version → it's genuinely our old daemon.
	return "shutdown-then-respawn";
}

export type ShutdownAction = "stop" | "no-op";

// Decide whether `clv shutdown` should stop the daemon on the port. Mirrors
// decideDaemonAction's ownership rule: only stop a daemon WE recorded. If the
// port is held by a process with a different pid than our state (stale state, a
// stranger took the port), do NOT stop it. With no state at all, honor the
// explicitly targeted port (nothing to compare against).
export function decideShutdownAction(
	state: { pid: number } | undefined,
	status: { clv: boolean; pid: number } | undefined,
): ShutdownAction {
	if (!status?.clv) return "no-op";
	if (state && status.pid !== state.pid) return "no-op"; // stranger holds the port
	return "stop";
}

// Find a usable daemon, spawning one when necessary. See `decideDaemonAction`
// for the decision table. Always returns the ACTUAL port the daemon bound (never
// assumes the requested one — see the ephemeral fallback in startServer).
//
// `spawned` tells the caller whether a NEW daemon was launched (true) or an
// existing healthy one was connected to (false). On connect, `status` carries
// that daemon's reported settings so the caller can warn on a theme/watch
// mismatch without a second round-trip.
export async function findOrSpawnDaemon(opts: {
	port: number;
	theme: DaemonTheme;
	watch: boolean;
}): Promise<{ port: number; spawned: boolean; status?: DaemonStatus }> {
	const st = readState();
	const status = st ? await probeStatus(st.port, 500) : undefined;
	const action = decideDaemonAction(st, status, isPidAlive);

	if (action === "connect") {
		// `status` is defined and `status.pid === st.pid` here (see decideDaemonAction).
		return { port: status!.port, spawned: false, status: status! };
	}
	if (action === "shutdown-then-respawn") {
		// Version mismatch on our own old daemon: ask it to step down, then respawn.
		console.error(`clv: replacing daemon (running ${status!.version || "?"}, this is ${VERSION})`);
		try {
			await fetch(`http://localhost:${st!.port}/api/shutdown`, {
				method: "POST",
				signal: AbortSignal.timeout(500),
			});
		} catch {
			// best-effort; we still wait and clear below.
		}
		await waitUntilUnreachable(st!.port, 3000);
		clearState();
	} else if (action === "clear-then-respawn") {
		// Stale/foreign state file: drop it and respawn (never shut down a stranger).
		clearState();
	}

	// Spawn the detached daemon. It re-execs THIS CLI with the hidden --__daemon
	// flag. env is inherited (omit `env` so CLV_STATE_DIR etc. propagate).
	const argv = [
		process.execPath,
		Bun.argv[1]!,
		"--__daemon",
		"--port",
		String(opts.port),
		"--theme",
		opts.theme,
		...(opts.watch ? [] : ["--no-watch"]),
	];
	const proc = Bun.spawn(argv, {
		stdin: "ignore",
		stdout: "ignore",
		stderr: "ignore",
		detached: true,
	});
	proc.unref();

	const ready = await waitForDaemon(5000);
	if (!ready) {
		throw new Error("daemon did not become ready within 5s");
	}
	return { port: ready.port, spawned: true };
}

// Entry the DETACHED process runs. Restores the prior session (files that still
// exist) so a restart reappears them — mo-style merge: a fresh `clv newfile.md`
// against a new daemon restores prior files THEN adds newfile. Starts the server
// with the restored paths, persists discovery state, and stays alive. Session
// membership changes (add/unlink/POST) are written back via onSessionChange.
export async function runDaemonMain(opts: { port: number; theme: DaemonTheme; watch: boolean }): Promise<void> {
	// Filter to files that still exist — skip-nonexistent avoids resurrecting
	// files deleted while the daemon was down.
	const restored = (readSession()?.files ?? []).filter((f) => existsSync(f));

	const srv = await startServer({
		paths: restored,
		port: opts.port,
		theme: opts.theme,
		watch: opts.watch,
		recursive: false,
		fallbackToEphemeralPort: true,
		// Persist the session on every membership change so a later restart restores
		// it. Note the single-session limitation (one session.json, not per-port).
		onSessionChange: (files) => writeSession({ files }),
		// Graceful shutdown from POST /api/shutdown: clear discovery state, stop the
		// server, exit. The server flushes the 200 before this runs (setTimeout). Do
		// NOT clear the session here — persistence should survive a shutdown so a
		// later start restores it.
		onShutdown: () => {
			clearState();
			srv.stop();
			process.exit(0);
		},
	});

	writeState({ port: srv.port, pid: process.pid, version: VERSION, startedAt: Date.now() });

	const shutdown = (): void => {
		clearState();
		srv.stop();
		process.exit(0);
	};
	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);

	// Bun.serve keeps the event loop alive; do not exit here.
}

// Wait (~timeout) for a freshly spawned daemon to come up and report its port.
// We trust the port reported in state/status (the daemon may have fallen back to
// an ephemeral port if the requested one was held by a non-clv process).
async function waitForDaemon(timeoutMs: number): Promise<{ port: number } | undefined> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const st = readState();
		if (st) {
			const status = await probeStatus(st.port, 500);
			if (status?.clv) return { port: status.port };
		}
		await Bun.sleep(50);
	}
	return undefined;
}

// Poll until a candidate port stops responding to /api/status (used after
// requesting a version-mismatched daemon to shut down).
async function waitUntilUnreachable(port: number, timeoutMs: number): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const status = await probeStatus(port, 300);
		if (!status) return;
		await Bun.sleep(50);
	}
}
