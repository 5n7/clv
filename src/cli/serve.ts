import { VERSION } from "@shared/version";
import type { WsServerMessage } from "@shared/ws";
import { realpathSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

import { injectServer } from "./inject";
import { expandPaths, fileIdFromPath, Session } from "./session";
import { createWatcher } from "./watch";

export type ServerOptions = {
	paths: string[];
	// 0 → OS-assigned free port (the returned `port` reports the real one).
	port: number;
	theme: "auto" | "light" | "dark";
	// Watch registered files/dirs and push WS updates. Default ON at the CLI.
	watch: boolean;
	// Recurse into subdirectories when expanding/watching directory inputs.
	recursive: boolean;
	// Daemon mode: if `port` is taken by a NON-clv process (EADDRINUSE), retry
	// once on an OS-assigned ephemeral port instead of throwing. The returned
	// `port` reports the actual port the server bound.
	fallbackToEphemeralPort?: boolean;
	// Daemon mode: invoked by `POST /api/shutdown` after the response flushes.
	// When omitted, the route just calls `stop()`.
	onShutdown?: () => void | Promise<void>;
	// Fired with the current set of registered absolute paths whenever session
	// membership changes (initial register, watcher add/unlink, POST /api/files).
	// The daemon uses this to persist the session for restore-on-restart.
	onSessionChange?: (absPaths: string[]) => void;
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
	const { files, dirs } = expandPaths(opts.paths, { recursive: opts.recursive });
	session.register(files);

	// Notify the owner (daemon) of the current registered path set so it can
	// persist the session. Fired on membership changes only (add/unlink), not on
	// content `change` events.
	const notifySession = (): void => opts.onSessionChange?.(session.list().map((e) => e.path));
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
			session.register([e.path]);
			broadcast({ type: "files-changed", files: session.list() });
			notifySession();
			return;
		}
		// unlink
		session.remove(id);
		broadcast({ type: "files-changed", files: session.list() });
		notifySession();
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
		const expanded = expandPaths(paths, { recursive });
		session.register(expanded.files);
		watcher?.add({ files: expanded.files, dirs: expanded.dirs });
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
