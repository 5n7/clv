import { VERSION } from "@shared/version";
import type { WsServerMessage } from "@shared/ws";
import { realpathSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

import { resolveAutoGroup } from "./git";
import { injectServer } from "./inject";
import { expandPaths, fileIdFromPath, Session } from "./session";
import { createWatcher } from "./watch";

export type ServerOptions = {
	paths: string[];
	// Explicit sidebar group for the initial `paths` (and the dir roots they expand
	// to) when the user passed `-g`/`--group` — it then applies to ALL of them. When
	// ABSENT (auto mode), each file is grouped by the GitHub owner/repo of the repo
	// its OWN directory belongs to (else "default"), resolved on the server. Auto
	// resolution is path-based, so it is correct regardless of the daemon's cwd.
	group?: string;
	// Recurse into subdirectories when expanding/watching directory inputs.
	recursive: boolean;
	// Daemon mode: per-file session restore. Each restored file is registered with
	// its OWN group (last-write-wins over the initial `paths`/`group` register), so
	// a daemon restart reappears every prior file in its original sidebar group.
	// Restored individual files do NOT seed dir-watch roots (they never did).
	restore?: Array<{ path: string; group: string }>;
	// 0 → OS-assigned free port (the returned `port` reports the real one).
	port: number;
	theme: "auto" | "light" | "dark";
	// Watch registered files/dirs and push WS updates. Default ON at the CLI.
	watch: boolean;
	// Daemon mode: if `port` is taken by a NON-clv process (EADDRINUSE), retry
	// once on an OS-assigned ephemeral port instead of throwing. The returned
	// `port` reports the actual port the server bound.
	fallbackToEphemeralPort?: boolean;
	// Daemon mode: invoked by `POST /api/shutdown` after the response flushes.
	// When omitted, the route just calls `stop()`.
	onShutdown?: () => void | Promise<void>;
	// Fired with the current registered files (path + group) whenever session
	// membership changes (initial register, watcher add/unlink, POST /api/files).
	// The daemon uses this to persist the session for restore-on-restart.
	onSessionChange?: (files: Array<{ path: string; group: string }>) => void;
};

export type RunningServer = {
	port: number;
	stop: () => void;
};

type WsData = Record<string, never>;

// Loopback hostnames a request's Origin/Host may carry. Anything else is treated
// as remote and rejected by `isLocalRequest`. Note: `URL.hostname` preserves the
// brackets for IPv6 (`http://[::1]:p` → `[::1]`), so the bracketed form is what we
// actually compare against; the bare `::1` is kept for completeness.
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// Start the serve-mode HTTP+WS server (file watching, WS broadcast, multi-file
// registration). No daemon lifecycle or port-in-use fallback here.
export async function startServer(opts: ServerOptions): Promise<RunningServer> {
	const session = new Session();

	// Per-directory auto-group cache: maps a file's DIRECTORY → its resolved
	// auto-group (the GitHub owner/repo of the repo that dir belongs to, else
	// "default"), so we don't re-run `git` for every file in the same directory.
	// `resolveAutoGroup` runs `git -C <dir>`, which walks up to the repo root, so a
	// file's own dir is enough to find its repo. cwd-independent by construction.
	// No invalidation: a daemon's lifetime is short and a mid-session remote change
	// is not worth re-probing for.
	const autoGroupCache = new Map<string, string>();
	const autoGroupFor = (absPath: string): string => {
		const dir = dirname(absPath);
		let group = autoGroupCache.get(dir);
		if (group === undefined) {
			group = resolveAutoGroup(dir) ?? "default";
			autoGroupCache.set(dir, group);
		}
		return group;
	};
	// Per-file group resolver: an explicit group (from `-g` or a POST body) applies
	// verbatim to every file; absent → auto-group by the file's own repo. Used at
	// every registration site so the rule is uniform.
	const groupFor = (absPath: string, explicit: string | undefined): string => explicit ?? autoGroupFor(absPath);

	const { files, dirs } = expandPaths(opts.paths, { recursive: opts.recursive });
	// Register each file individually: in auto mode the group differs per file (by
	// its own repo), so a single bulk `register(files, group)` won't do. Per-file
	// `register([file], g)` is last-write-wins and preserves insertion order.
	for (const file of files) session.register([file], groupFor(file, opts.group));

	// Per-directory group registry: maps each EXPLICITLY-grouped watched directory
	// root → that group, so a watcher-added file inherits the group of the most
	// specific (longest-prefix) registering directory. Seeded ONLY from an explicit
	// `opts.group`; updated by every POST /api/files that carries an explicit group.
	// Auto (no-explicit) dirs are deliberately NOT seeded — a watcher-added file
	// there auto-resolves by its OWN repo via `autoGroupFor`. A Map keyed by the
	// absolute root gives LAST-WRITE-WINS per root (re-POSTing the same dir under a
	// new group overwrites the old one) AND bounds growth (no duplicate entries).
	// Lives here (not in session.ts) because it tracks WATCH roots, not files. NOT
	// touched by restore: restored individual files carry their own group but add
	// no dir watches.
	const dirGroups = new Map<string, string>();
	if (opts.group !== undefined) for (const root of dirs) dirGroups.set(root, opts.group);

	// Daemon restore: register each prior file with its OWN group. Runs AFTER the
	// initial register so a file present in both wins with the restore group
	// (last-write-wins); insertion order keeps restored files ahead of fresh ones.
	if (opts.restore) {
		for (const f of opts.restore) session.register([f.path], f.group);
	}

	// Notify the owner (daemon) of the current registered file set (path + group)
	// so it can persist the session. Fired on membership changes only (add/unlink),
	// not on content `change` events.
	const notifySession = (): void => opts.onSessionChange?.(session.entries());
	notifySession();

	// SPA shell with the serve-mode config injected; the client derives the ws
	// URL from `location`, so only `apiBase` needs injecting.
	const shell = injectServer({ apiBase: "/api" });

	const sockets = new Set<Bun.ServerWebSocket<WsData>>();

	const broadcast = (msg: WsServerMessage): void => {
		const payload = JSON.stringify(msg);
		for (const ws of sockets) ws.send(payload);
	};

	// Watcher is created only when enabled; kept mutable so POST /api/files can
	// extend it without recreating (recreating would drop in-flight debounce
	// timers). `add()` registers new files/dirs on the live watcher instance.
	const watcher = opts.watch ? createWatcher({ files, dirs, recursive: opts.recursive }, onWatchEvent) : undefined;

	function onWatchEvent(e: { type: "change" | "add" | "unlink"; path: string }): void {
		const id = fileIdFromPath(e.path);
		if (e.type === "change") {
			if (!session.has(id)) return;
			void session.loadDoc(id, { theme: opts.theme }).then((doc) => {
				if (doc) broadcast({ type: "doc-changed", fileId: id, doc });
			});
			return;
		}
		if (e.type === "add") {
			// An explicitly-grouped registering dir (longest-prefix) wins; otherwise the
			// file auto-resolves by its own repo. So a file created under a `-g`'d dir
			// inherits that explicit group, while one under an auto dir gets its repo's.
			session.register([e.path], explicitDirGroup(e.path) ?? autoGroupFor(e.path));
			broadcast({ type: "files-changed", files: session.list() });
			notifySession();
			return;
		}
		// unlink
		session.remove(id);
		broadcast({ type: "files-changed", files: session.list() });
		notifySession();
	}

	// Look up the EXPLICIT group of a watcher-added file by the LONGEST matching
	// directory root in `dirGroups` (the most specific registering dir wins when
	// roots nest), or `undefined` when no EXPLICITLY-grouped root contains it (the
	// caller then falls back to auto-resolution by the file's own repo). A root
	// matches when the path is the root itself or sits beneath it (`root + sep`
	// prefix, so `/a/docs` doesn't match `/a/docs-old`). `dirGroups` now holds only
	// explicit roots, so a hit always means an explicit group.
	function explicitDirGroup(absPath: string): string | undefined {
		let best: { root: string; group: string } | undefined;
		for (const [root, group] of dirGroups) {
			if (absPath === root || absPath.startsWith(root + sep)) {
				if (!best || root.length > best.root.length) best = { root, group };
			}
		}
		return best?.group;
	}

	// Build the Bun.serve config once; the EADDRINUSE/ephemeral retry below reuses
	// it with a different `port`. The explicit type annotation gives the inline
	// `fetch`/`websocket` handlers their parameter types.
	const makeConfig = (port: number): Bun.Serve.Options<WsData> => ({
		port,
		// Bind loopback only: this is a local dev tool, never exposed to the LAN.
		hostname: "127.0.0.1",
		async fetch(req, srv) {
			const url = new URL(req.url);
			const path = url.pathname;

			// Single early guard for EVERY route (WS, all /api/*, /assets/*, the SPA
			// shell). Blocks cross-site WS hijacking AND DNS-rebinding reads of the GET
			// data/asset endpoints: a foreign page rebound to 127.0.0.1 carries a
			// foreign Host (or Origin) and is rejected here before any handler runs.
			// Native clients (curl, the daemon probe/IPC) and top-level browser
			// navigations omit Origin and carry a loopback Host → allowed.
			if (!isLocalRequest(req)) return new Response("forbidden", { status: 403 });

			if (path === "/ws") {
				if (srv.upgrade(req, { data: {} })) return undefined;
				return new Response("expected websocket upgrade", { status: 426 });
			}

			if (path === "/api/status") {
				return json({
					clv: true,
					version: VERSION,
					port: srv.port,
					pid: process.pid,
					files: session.list().length,
					// The daemon's effective theme/watch are fixed at start for its
					// lifetime; expose them so a connecting `clv` can warn on a mismatch.
					theme: opts.theme,
					watch: opts.watch,
				});
			}

			// Graceful shutdown for the daemon: respond first, then run the shutdown
			// hook on a later tick so the 200 flushes before the process exits.
			if (path === "/api/shutdown" && req.method === "POST") {
				setTimeout(() => {
					void (opts.onShutdown ? opts.onShutdown() : stop());
				}, 10);
				return json({ ok: true });
			}

			if (path === "/api/files") {
				if (req.method === "POST") {
					return handleAddFiles(req);
				}
				return json(session.list());
			}

			// Close (remove-from-session) one or more files. Checked BEFORE the
			// `/api/files/:id` regex below so the literal "close" segment never falls
			// into the GET-only id branch (ids are `f-<hash>`, so "close" would 404
			// there anyway, but the explicit POST match removes any ambiguity).
			if (path === "/api/files/close" && req.method === "POST") {
				return handleCloseFiles(req);
			}

			const fileMatch = path.match(/^\/api\/files\/([^/]+)$/);
			if (fileMatch) {
				const id = safeDecode(fileMatch[1]!);
				if (id === undefined) return new Response("bad request", { status: 400 });
				if (!session.has(id)) return json({ error: "unknown file id" }, 404);
				const doc = await session.loadDoc(id, { theme: opts.theme });
				return doc ? json(doc) : json({ error: "unknown file id" }, 404);
			}

			// Local asset serving: `/assets/<fileId>/<relative-path>` resolves a file
			// relative to the registered markdown's directory. The relative path can be
			// multiple segments, so capture everything after the id. NOTE: `new URL`
			// above already normalized literal `..`/`.` segments out of `path`, so only
			// PERCENT-ENCODED traversal (`%2e%2e`) reaches serveAsset's guard.
			const assetMatch = path.match(/^\/assets\/([^/]+)\/(.+)$/);
			if (assetMatch) {
				const fileId = safeDecode(assetMatch[1]!);
				const rest = safeDecode(assetMatch[2]!);
				if (fileId === undefined || rest === undefined) return new Response("bad request", { status: 400 });
				return serveAsset(fileId, rest);
			}

			// Any non-API, non-asset path → serve the SPA shell. no-cache: the shell
			// embeds live config; never let a stale shell stick on deep-linked reloads.
			return new Response(shell, {
				headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" },
			});
		},
		websocket: {
			open(ws) {
				sockets.add(ws);
				ws.send(JSON.stringify({ type: "hello", version: VERSION }));
			},
			close(ws) {
				sockets.delete(ws);
			},
			message() {
				// Client→server messages are unused; the contract is server→client only.
			},
		},
	});

	// Bind the server. In daemon mode, a NON-clv process holding the requested
	// port surfaces as EADDRINUSE; with `fallbackToEphemeralPort` we retry once on
	// port 0 (OS-assigned) so the daemon still comes up. Other errors propagate.
	const isAddrInUse = (err: unknown): boolean => {
		const code = (err as NodeJS.ErrnoException)?.code;
		return code === "EADDRINUSE" || String((err as Error)?.message ?? "").includes("EADDRINUSE");
	};
	let server: Bun.Server<WsData>;
	try {
		server = Bun.serve<WsData>(makeConfig(opts.port));
	} catch (err) {
		if (opts.fallbackToEphemeralPort && isAddrInUse(err)) {
			server = Bun.serve<WsData>(makeConfig(0));
		} else {
			throw err;
		}
	}

	// Add files/dirs to a live session: { paths: string[]; recursive?: boolean }.
	// Each registration carries its own `recursive` intent (the daemon is
	// long-lived and per-invocation recursion differs); falls back to the
	// server's setting when omitted. Expands, registers, extends the watcher
	// (when watching), broadcasts files-changed, and returns the updated list.
	//
	// WATCHER RECURSION LIMITATION: the watcher's recursive flag is fixed at daemon
	// spawn, so a later `-R dir` POST won't pick up files
	// CREATED later in subdirs if the daemon started without -R. Existing-file
	// registration and live-reload of already-known files still work.
	async function handleAddFiles(req: Request): Promise<Response> {
		let body: unknown;
		try {
			body = await req.json();
		} catch {
			return json({ error: "invalid JSON body" }, 400);
		}
		const paths = (body as { paths?: unknown })?.paths;
		if (!Array.isArray(paths) || !paths.every((p) => typeof p === "string")) {
			return json({ error: "expected { paths: string[] }" }, 400);
		}
		// Runtime-validate `recursive` (mirroring the `paths` check above): only an
		// explicit boolean — including `false` — is honored; a non-boolean (e.g. the
		// string "false", which is truthy and would force unintended recursion) or an
		// absent field defers to the daemon's `opts.recursive`.
		const recursiveBody = (body as { recursive?: unknown }).recursive;
		const recursive = typeof recursiveBody === "boolean" ? recursiveBody : opts.recursive;
		// An EXPLICIT `group` string in the body applies to ALL paths in this POST;
		// an absent/non-string value means AUTO — each file is grouped by its own
		// repo (`autoGroupFor`). The CLI sends `group` only for an explicit `-g`.
		const groupBody = (body as { group?: unknown }).group;
		const explicit = typeof groupBody === "string" ? groupBody : undefined;
		const expanded = expandPaths(paths, { recursive });
		// Record this POST's dir roots BEFORE registering so a watcher `add` for a
		// file created under them resolves the right group on its first event — but
		// ONLY for an explicit group. Auto dirs are intentionally not seeded; files
		// created under them auto-resolve by their own repo. `.set` overwrites a
		// prior group for the same root (last-write-wins) and keeps the registry
		// bounded across repeated POSTs.
		if (explicit !== undefined) for (const root of expanded.dirs) dirGroups.set(root, explicit);
		// Register each file individually: in auto mode the group differs per file.
		for (const file of expanded.files) session.register([file], groupFor(file, explicit));
		watcher?.add({ files: expanded.files, dirs: expanded.dirs });
		const list = session.list();
		broadcast({ type: "files-changed", files: list });
		notifySession();
		return json(list);
	}

	// Close (remove-from-session) files by id: { ids: string[] }. This drops each
	// file from the live session ONLY — it never touches disk. Validated like
	// handleAddFiles: a non-JSON body or a non-`string[]` `ids` is a 400.
	//
	// Unknown ids are silently ignored (session.remove is a no-op for them), so the
	// call is idempotent — re-closing an already-closed id is a 200 with the same
	// list. After removing every id we fire ONE broadcast + ONE notifySession so the
	// sidebar updates live and the daemon persists the smaller set (a closed file
	// therefore does NOT reappear on restart).
	//
	// WATCHER INTERACTION: a closed file that still EXISTS on disk inside a watched
	// dir will NOT reappear from `change` events — `onWatchEvent`'s "change" branch
	// returns early when `!session.has(id)`. Only an explicit re-`clv <file>` (POST
	// /api/files) or a delete+recreate (an `add` event) brings it back. Intended.
	async function handleCloseFiles(req: Request): Promise<Response> {
		let body: unknown;
		try {
			body = await req.json();
		} catch {
			return json({ error: "invalid JSON body" }, 400);
		}
		const ids = (body as { ids?: unknown })?.ids;
		if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
			return json({ error: "expected { ids: string[] }" }, 400);
		}
		for (const id of ids) session.remove(id);
		const list = session.list();
		broadcast({ type: "files-changed", files: list });
		notifySession();
		return json(list);
	}

	// Serve a local asset referenced by a markdown file. `fileId` selects the
	// registered file; `rest` is the already-decoded asset path relative to that
	// file's directory. Path-traversal guard (security floor): the resolved target
	// MUST stay within the file's directory; anything escaping it gets 403.
	function serveAsset(fileId: string, rest: string): Response {
		const filePath = session.pathOf(fileId);
		if (!filePath) return new Response("unknown file id", { status: 404 });

		const base = dirname(filePath);
		// `path.resolve` normalizes `..`, so this lexical check defends both raw
		// `../` and (already-decoded) percent-encoded `%2e%2e/` traversal variants.
		const resolved = resolve(base, rest);
		if (resolved !== base && !resolved.startsWith(base + sep)) {
			return new Response("forbidden", { status: 403 });
		}

		// Lexical resolution does not follow symlinks, so a symlink INSIDE the
		// directory pointing outside it (e.g. `docs/leak -> /etc/passwd`) passes the
		// check above. Re-check against realpaths to close that escape. realpathSync
		// throws ENOENT for a missing target → 404; other errors propagate.
		let realBase: string;
		let realResolved: string;
		try {
			realBase = realpathSync(base);
			realResolved = realpathSync(resolved);
		} catch (err) {
			if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
				return new Response("not found", { status: 404 });
			}
			throw err;
		}
		if (realResolved !== realBase && !realResolved.startsWith(realBase + sep)) {
			return new Response("forbidden", { status: 403 });
		}

		// A successful statSync implies the target exists, so `isFile()` decides
		// dir-vs-file; a throw (missing/unreadable) leaves isFile false. Either way,
		// anything that is not a regular file → 404.
		let isFile = false;
		try {
			isFile = statSync(realResolved).isFile();
		} catch {
			// missing/unreadable → 404 below
		}
		if (!isFile) {
			return new Response("not found", { status: 404 });
		}
		// Serve via the realpath (defense in depth). Bun derives content-type from
		// the extension. no-cache: assets can change live during editing.
		return new Response(Bun.file(realResolved), { headers: { "cache-control": "no-cache" } });
	}

	// The server is listening, so `port` is defined; capture it for the closures.
	const listenPort = server.port ?? opts.port;

	// stop(true) force-closes active connections/WS so callers (and tests) do not
	// hang waiting for an open socket to drain; also tears down the watcher.
	const stop = (): void => {
		watcher?.close();
		void server.stop(true);
	};

	return { port: listenPort, stop };
}

// Cross-site WebSocket-hijacking + DNS-rebinding defense for a local-only dev
// tool. Applied as a single top-of-`fetch` guard covering every route. The
// contract:
//   - Origin: if present, allow ONLY when its hostname is loopback (port ignored);
//     reject otherwise. Absent (native clients: curl, the daemon's probe/shutdown
//     IPC, integration tests) → allow.
//   - Host: if present, allow ONLY when its hostname is loopback (DNS-rebinding
//     defense — a rebound DNS name resolves to 127.0.0.1 but carries a foreign
//     Host). Absent → allow.
// A malformed Origin/Host that fails to parse is rejected.
function isLocalRequest(req: Request): boolean {
	const origin = req.headers.get("origin");
	if (origin !== null) {
		try {
			if (!LOCAL_HOSTNAMES.has(new URL(origin).hostname.toLowerCase())) return false;
		} catch {
			return false;
		}
	}
	const host = req.headers.get("host");
	if (host !== null) {
		try {
			if (!LOCAL_HOSTNAMES.has(new URL(`http://${host}`).hostname.toLowerCase())) return false;
		} catch {
			return false;
		}
	}
	return true;
}

function json(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});
}

// `decodeURIComponent` throws `URIError` on malformed escapes (e.g. `%zz`). Path
// segments are attacker-controlled, so guard every decode: undefined signals a
// caller-handled 400 instead of an unhandled throw crashing the request.
function safeDecode(s: string): string | undefined {
	try {
		return decodeURIComponent(s);
	} catch {
		return undefined;
	}
}
