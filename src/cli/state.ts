import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Daemon discovery state (mo-style background daemon). Persisted to a small JSON
// file so a fresh `clv` invocation can find and connect to an already-running
// daemon. PURE-ish: the cache dir is overridable via CLV_STATE_DIR for tests.

export type DaemonState = {
	port: number;
	pid: number;
	version: string;
	startedAt: number;
};

// Persisted serve session: the set of files registered with the daemon, so a
// restart can restore them (mo-style merge). SINGLE-SESSION LIMITATION: this is
// one unkeyed file, not per-port — fine for the default single-daemon use; a
// second daemon on another port would share/overwrite this same session file.
//
// SHAPE MIGRATION: the original on-disk shape was `{ files: string[] }` (bare
// absolute paths). The current shape carries a `group` per file so the daemon
// can restore each file into its sidebar group. `readSession` reads BOTH and
// migrates a bare string to `{ path, group: "default" }`.
export type SessionFile = { path: string; group: string };
export type SessionState = { files: SessionFile[] };

function isDaemonState(parsed: unknown): parsed is DaemonState {
	const s = parsed as Partial<DaemonState>;
	return (
		typeof s?.port === "number" &&
		typeof s.pid === "number" &&
		typeof s.version === "string" &&
		typeof s.startedAt === "number"
	);
}

// A single on-disk session element: either a legacy bare path string or the
// current `{ path, group }` object. `readSession` normalizes both to SessionFile.
type RawSessionFile = string | { path: string; group: string };

// Validate the on-disk session shape, accepting BOTH the legacy `string[]` and
// the current `{ path, group }[]` (and a mix of the two during the migration
// window). Each element is checked independently; a malformed object element
// (e.g. missing `group`) fails the whole file → "no session".
function isRawSessionState(parsed: unknown): parsed is { files: RawSessionFile[] } {
	const files = (parsed as { files?: unknown })?.files;
	return (
		Array.isArray(files) &&
		files.every(
			(f) =>
				typeof f === "string" ||
				(typeof f === "object" &&
					f !== null &&
					typeof (f as { path?: unknown }).path === "string" &&
					typeof (f as { group?: unknown }).group === "string"),
		)
	);
}

// Absolute path to the daemon state file (exported for tests).
export function stateFilePath(): string {
	return join(stateDir(), "daemon.json");
}

// Absolute path to the session file (exported for tests). Same CLV_STATE_DIR
// override as the daemon state.
export function sessionFilePath(): string {
	return join(stateDir(), "session.json");
}

// Read the persisted daemon state. Returns undefined when the file is absent or
// cannot be parsed into a plausible DaemonState (treated as "no daemon").
export function readState(): DaemonState | undefined {
	return readJsonFile(stateFilePath(), isDaemonState);
}

// Persist the daemon state, creating the cache dir if needed.
export function writeState(s: DaemonState): void {
	writeJsonFile(stateFilePath(), s);
}

// Remove the state file; ignore a missing file (ENOENT).
export function clearState(): void {
	removeFile(stateFilePath());
}

// Read the persisted session. Returns undefined when absent or unparseable.
// Migrates each legacy bare-string element to `{ path, group: "default" }` so
// callers always see the uniform SessionFile shape.
export function readSession(): SessionState | undefined {
	const parsed = readJsonFile(sessionFilePath(), isRawSessionState);
	if (!parsed) return undefined;
	const files = parsed.files.map<SessionFile>((f) =>
		typeof f === "string" ? { path: f, group: "default" } : { path: f.path, group: f.group },
	);
	return { files };
}

// Persist the session, creating the cache dir if needed.
export function writeSession(s: SessionState): void {
	writeJsonFile(sessionFilePath(), s);
}

// Remove the session file; ignore a missing file (ENOENT).
export function clearSession(): void {
	removeFile(sessionFilePath());
}

// Is the process with `pid` alive? `process.kill(pid, 0)` sends no signal but
// performs the permission/existence check: ESRCH → dead; EPERM → alive but not
// ours (still counts as alive).
export function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return (err as NodeJS.ErrnoException).code === "EPERM";
	}
}

// Resolve the cache directory holding the daemon state file. CLV_STATE_DIR wins
// (tests/explicit override); otherwise OS-appropriate caches dir.
function stateDir(): string {
	const override = process.env.CLV_STATE_DIR;
	if (override) return override;

	if (process.platform === "darwin") {
		return join(homedir(), "Library", "Caches", "clv");
	}
	if (process.platform === "win32") {
		const local = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
		return join(local, "clv");
	}
	// Linux/other: XDG_CACHE_HOME (when set and non-empty) or ~/.cache.
	const xdg = process.env.XDG_CACHE_HOME;
	return join(xdg || join(homedir(), ".cache"), "clv");
}

// Read + JSON.parse a state file, returning undefined when it's absent,
// unparseable, or fails the caller's shape check. Both layers (file read and
// JSON.parse) are guarded so a missing or corrupt file is treated as "no state".
function readJsonFile<T>(path: string, isValid: (parsed: unknown) => parsed is T): T | undefined {
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		return isValid(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

// Serialize + write a state file, creating the cache dir if needed.
function writeJsonFile(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(value));
}

// Remove a state file; ignore a missing file (ENOENT, already swallowed by force).
function removeFile(path: string): void {
	try {
		rmSync(path, { force: true });
	} catch {
		// best-effort; force already swallows ENOENT.
	}
}
