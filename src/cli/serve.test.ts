import type { Document, FileEntry } from "@shared/types";
import type { WsServerMessage } from "@shared/ws";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { symlinkSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseDocument } from "./parse";
import { type RunningServer, startServer } from "./serve";
import { fileIdFromPath } from "./session";

const MARKDOWN = [
	"# Serve Title",
	"",
	"Some prose.",
	"",
	"```clv:callout",
	'{ "kind": "info", "body": "hello" }',
	"```",
	"",
].join("\n");

let dir: string;
let filePath: string;
let srv: RunningServer;
let base: string;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "clv-serve-"));
	filePath = join(dir, "doc.md");
	await Bun.write(filePath, MARKDOWN);
	// port 0 → OS-assigned free port (avoids CI collisions).
	srv = await startServer({ paths: [filePath], port: 0, theme: "auto", watch: true, recursive: false });
	base = `http://localhost:${srv.port}`;
});

afterAll(async () => {
	srv.stop();
	await rm(dir, { recursive: true, force: true });
});

describe("startServer — HTTP API", () => {
	test("GET /api/status reports the daemon-identity probe", async () => {
		const res = await fetch(`${base}/api/status`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			clv: boolean;
			port: number;
			pid: number;
			files: number;
			version: string;
			theme: string;
			watch: boolean;
		};
		expect(body.clv).toBe(true);
		expect(body.port).toBe(srv.port);
		expect(body.pid).toBe(process.pid);
		expect(body.files).toBe(1);
		expect(typeof body.version).toBe("string");
		// Daemon settings surfaced for connect-time mismatch detection.
		expect(body.theme).toBe("auto");
		expect(body.watch).toBe(true);
	});

	test("GET /api/files lists the registered file with a derived id", async () => {
		const res = await fetch(`${base}/api/files`);
		expect(res.status).toBe(200);
		const files = (await res.json()) as Array<{ id: string; displayName: string; title: string }>;
		expect(files).toHaveLength(1);
		expect(files[0]!.id).toBe(fileIdFromPath(filePath));
		expect(files[0]!.displayName).toBe("doc.md");
		expect(files[0]!.title).toBe("Serve Title");
	});

	test("GET /api/files/:id returns a Document equal to parseDocument output", async () => {
		const id = fileIdFromPath(filePath);
		const res = await fetch(`${base}/api/files/${id}`);
		expect(res.status).toBe(200);
		const doc = (await res.json()) as Document;
		expect(doc.nodes.length).toBeGreaterThan(0);

		const expected = parseDocument(MARKDOWN, { title: "Serve Title", theme: "auto", source: "doc.md" }).doc;
		// `generated` is a timestamp and will differ between runs.
		expect(doc.nodes).toEqual(expected.nodes);
		expect(doc.title).toBe(expected.title);
	});

	test("GET /api/files/:id returns 404 for an unknown id", async () => {
		const res = await fetch(`${base}/api/files/f-deadbeef0000`);
		expect(res.status).toBe(404);
	});

	test("GET / serves the SPA shell with __CLV_SERVER__ and not __CLV_DATA__", async () => {
		const res = await fetch(`${base}/`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/html");
		const html = await res.text();
		expect(html).toContain("__CLV_SERVER__");
		expect(html).not.toContain("__CLV_DATA__");
	});

	test("GET /api/files/%zz (malformed escape) returns 400, not a 500/crash", async () => {
		const res = await fetch(`${base}/api/files/%zz`);
		expect(res.status).toBe(400);
	});

	test("GET /assets/<id>/%zz (malformed escape) returns 400, not a 500/crash", async () => {
		const id = fileIdFromPath(filePath);
		const res = await fetch(`${base}/assets/${id}/%zz`);
		expect(res.status).toBe(400);
	});
});

describe("startServer — Origin/Host guard (cross-site WS hijack + DNS rebinding)", () => {
	test("WS upgrade with a foreign Origin returns 403 (before upgrade)", async () => {
		const res = await fetch(`${base}/ws`, {
			headers: { Origin: "https://evil.example", Upgrade: "websocket", Connection: "Upgrade" },
		});
		expect(res.status).toBe(403);
	});

	test("WS upgrade with no Origin (native client) is NOT rejected by the guard", async () => {
		// No Origin → allowed past the guard; without real WS upgrade headers Bun
		// returns 426 (expected websocket upgrade), proving the 403 guard did not fire.
		const res = await fetch(`${base}/ws`);
		expect(res.status).toBe(426);
	});

	test("WS upgrade with same-origin (localhost) is NOT rejected by the guard", async () => {
		const res = await fetch(`${base}/ws`, { headers: { Origin: base } });
		expect(res.status).toBe(426);
	});

	test("POST /api/files with a foreign Origin returns 403", async () => {
		const res = await fetch(`${base}/api/files`, {
			method: "POST",
			headers: { "content-type": "application/json", Origin: "https://evil.example" },
			body: JSON.stringify({ paths: [] }),
		});
		expect(res.status).toBe(403);
	});

	test("POST /api/files with Origin: <localhost base> works (200)", async () => {
		const res = await fetch(`${base}/api/files`, {
			method: "POST",
			headers: { "content-type": "application/json", Origin: base },
			body: JSON.stringify({ paths: [] }),
		});
		expect(res.status).toBe(200);
	});

	test("POST /api/shutdown with a foreign Origin returns 403 (and does not shut down)", async () => {
		const res = await fetch(`${base}/api/shutdown`, {
			method: "POST",
			headers: { Origin: "https://evil.example" },
		});
		expect(res.status).toBe(403);
		// Server still alive afterward.
		const status = await fetch(`${base}/api/status`);
		expect(status.status).toBe(200);
	});

	// The GET data/asset endpoints are also guarded (DNS-rebinding read defense):
	// a single top-of-`fetch` guard rejects a foreign Origin OR a foreign Host.
	test("GET /api/files with a foreign Origin returns 403", async () => {
		const res = await fetch(`${base}/api/files`, { headers: { Origin: "https://evil.example" } });
		expect(res.status).toBe(403);
	});

	test("GET /api/files with a foreign Host (DNS rebinding, no Origin) returns 403", async () => {
		const res = await fetch(`${base}/api/files`, { headers: { Host: "evil.example" } });
		expect(res.status).toBe(403);
	});

	test("GET /api/files with no Origin and a loopback Host returns 200", async () => {
		// Native-client shape (curl, the daemon probe): no Origin, loopback Host.
		const res = await fetch(`${base}/api/files`);
		expect(res.status).toBe(200);
	});

	test("GET /api/files/:id with a foreign Origin returns 403", async () => {
		const id = fileIdFromPath(filePath);
		const res = await fetch(`${base}/api/files/${id}`, { headers: { Origin: "https://evil.example" } });
		expect(res.status).toBe(403);
	});

	test("GET /api/files/:id with a foreign Host (no Origin) returns 403", async () => {
		const id = fileIdFromPath(filePath);
		const res = await fetch(`${base}/api/files/${id}`, { headers: { Host: "evil.example" } });
		expect(res.status).toBe(403);
	});

	test("GET /api/files/:id with no Origin and a loopback Host returns 200", async () => {
		const id = fileIdFromPath(filePath);
		const res = await fetch(`${base}/api/files/${id}`);
		expect(res.status).toBe(200);
	});
});

describe("startServer — WebSocket", () => {
	test("a hello message arrives on connect", async () => {
		const ws = new WebSocket(`ws://localhost:${srv.port}/ws`);
		const hello = await new Promise<{ type: string; version: string }>((resolve, reject) => {
			ws.addEventListener("message", (e) => resolve(JSON.parse(String(e.data))));
			ws.addEventListener("error", () => reject(new Error("ws error")));
			setTimeout(() => reject(new Error("ws timeout")), 2000);
		});
		expect(hello.type).toBe("hello");
		expect(typeof hello.version).toBe("string");
		ws.close();
	});
});

// Collect every WS frame so we can filter by type later (hello always arrives
// first — never assert on the first frame).
function collectFrames(port: number): { frames: WsServerMessage[]; ws: WebSocket; ready: Promise<void> } {
	const frames: WsServerMessage[] = [];
	const ws = new WebSocket(`ws://localhost:${port}/ws`);
	ws.addEventListener("message", (e) => frames.push(JSON.parse(String(e.data)) as WsServerMessage));
	const ready = new Promise<void>((resolve, reject) => {
		ws.addEventListener("open", () => resolve());
		ws.addEventListener("error", () => reject(new Error("ws error")));
		setTimeout(() => reject(new Error("ws open timeout")), 2000);
	});
	return { frames, ws, ready };
}

async function waitFor<T>(predicate: () => T | undefined, timeoutMs = 3000): Promise<T> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const v = predicate();
		if (v !== undefined) return v;
		await Bun.sleep(25);
	}
	throw new Error("waitFor: timed out");
}

describe("startServer — watch broadcasts", () => {
	let wdir: string;
	let wsrv: RunningServer;

	afterEach(async () => {
		wsrv?.stop();
		if (wdir) await rm(wdir, { recursive: true, force: true });
	});

	test("writing a watched file broadcasts doc-changed with the new content", async () => {
		wdir = await mkdtemp(join(tmpdir(), "clv-watch-srv-"));
		const f = join(wdir, "a.md");
		await Bun.write(f, "# Old\n");
		wsrv = await startServer({ paths: [wdir], port: 0, theme: "auto", watch: true, recursive: false });

		const { frames, ws, ready } = collectFrames(wsrv.port);
		await ready;
		// Let the server's FSEvents watch attach before the first write.
		await Bun.sleep(150);

		await Bun.write(f, "# New Title\n\nfresh body\n");
		const id = fileIdFromPath(f);
		// Multiple doc-changed frames are permitted (debounced live-reload stream);
		// wait for the one carrying the post-write content. A stale frame can
		// precede it when FSEvents replays the setup write through the just-attached
		// watcher — that's a test artifact, not a contract violation.
		const msg = await waitFor(() =>
			frames.find(
				(m): m is Extract<WsServerMessage, { type: "doc-changed" }> =>
					m.type === "doc-changed" && m.fileId === id && m.doc.title === "New Title",
			),
		);
		expect(msg.doc.title).toBe("New Title");
		ws.close();
	});

	test("creating a second .md broadcasts files-changed listing both", async () => {
		wdir = await mkdtemp(join(tmpdir(), "clv-watch-srv-"));
		await Bun.write(join(wdir, "a.md"), "# A\n");
		wsrv = await startServer({ paths: [wdir], port: 0, theme: "auto", watch: true, recursive: false });

		const { frames, ws, ready } = collectFrames(wsrv.port);
		await ready;
		// Let the server's FSEvents watch attach before the first write.
		await Bun.sleep(150);

		await Bun.write(join(wdir, "b.md"), "# B\n");
		const msg = await waitFor(() =>
			frames.find(
				(m): m is Extract<WsServerMessage, { type: "files-changed" }> =>
					m.type === "files-changed" && m.files.length === 2,
			),
		);
		const names = msg.files.map((x: FileEntry) => x.displayName).sort();
		expect(names).toEqual(["a.md", "b.md"]);
		ws.close();
	});

	test("POST /api/files registers a path, grows the list, and broadcasts files-changed", async () => {
		wdir = await mkdtemp(join(tmpdir(), "clv-watch-srv-"));
		await Bun.write(join(wdir, "a.md"), "# A\n");
		const extra = join(wdir, "extra.md");
		await Bun.write(extra, "# Extra\n");
		// Start with only a.md registered (point at the file, not the dir).
		wsrv = await startServer({ paths: [join(wdir, "a.md")], port: 0, theme: "auto", watch: true, recursive: false });

		const { frames, ws, ready } = collectFrames(wsrv.port);
		await ready;

		const res = await fetch(`http://localhost:${wsrv.port}/api/files`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ paths: [extra] }),
		});
		expect(res.status).toBe(200);
		const list = (await res.json()) as FileEntry[];
		expect(list.map((x) => x.displayName).sort()).toEqual(["a.md", "extra.md"]);

		await waitFor(() =>
			frames.find(
				(m): m is Extract<WsServerMessage, { type: "files-changed" }> =>
					m.type === "files-changed" && m.files.length === 2,
			),
		);
		ws.close();
	});

	test("POST /api/files rejects a malformed body with 400", async () => {
		wdir = await mkdtemp(join(tmpdir(), "clv-watch-srv-"));
		await Bun.write(join(wdir, "a.md"), "# A\n");
		wsrv = await startServer({ paths: [join(wdir, "a.md")], port: 0, theme: "auto", watch: true, recursive: false });

		const res = await fetch(`http://localhost:${wsrv.port}/api/files`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ nope: true }),
		});
		expect(res.status).toBe(400);
	});

	test("POST /api/files honors an explicit recursive:false even when the daemon's recursive is true", async () => {
		wdir = await mkdtemp(join(tmpdir(), "clv-watch-srv-"));
		// A directory with a top-level .md and a nested one in a subdir.
		await Bun.write(join(wdir, "top.md"), "# Top\n");
		await Bun.write(join(wdir, "nested", "deep.md"), "# Deep\n");
		// Daemon defaults to recursive registration.
		wsrv = await startServer({ paths: [], port: 0, theme: "auto", watch: false, recursive: true });

		const res = await fetch(`http://localhost:${wsrv.port}/api/files`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ paths: [wdir], recursive: false }),
		});
		expect(res.status).toBe(200);
		const list = (await res.json()) as FileEntry[];
		// Only the top-level .md is registered — the nested one is excluded because the
		// body's explicit recursive:false overrides the daemon's recursive:true.
		expect(list.map((x) => x.displayName).sort()).toEqual(["top.md"]);
	});

	test("POST /api/files with a non-boolean recursive (string) falls back to the daemon setting, not truthy-true", async () => {
		wdir = await mkdtemp(join(tmpdir(), "clv-watch-srv-"));
		// Same nested fixture: a top-level .md and a nested one in a subdir.
		await Bun.write(join(wdir, "top.md"), "# Top\n");
		await Bun.write(join(wdir, "nested", "deep.md"), "# Deep\n");
		// Daemon's recursive is false; a malformed `recursive:"false"` must defer to it
		// (a string is truthy, so without runtime validation it would force recursion).
		wsrv = await startServer({ paths: [], port: 0, theme: "auto", watch: false, recursive: false });

		const res = await fetch(`http://localhost:${wsrv.port}/api/files`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ paths: [wdir], recursive: "false" }),
		});
		expect(res.status).toBe(200);
		const list = (await res.json()) as FileEntry[];
		// Only the top-level .md — the string `recursive` was ignored and the daemon's
		// recursive:false applied, so the nested file is excluded.
		expect(list.map((x) => x.displayName).sort()).toEqual(["top.md"]);
	});
});

describe("startServer — asset serving", () => {
	let adir: string;
	let asrv: RunningServer;
	let abase: string;
	let id: string;
	let innerId: string;
	const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03]);

	beforeAll(async () => {
		adir = await mkdtemp(join(tmpdir(), "clv-asset-"));
		const md = join(adir, "note.md");
		await Bun.write(md, "# Note\n\n![pic](pic.png)\n");
		await Bun.write(join(adir, "pic.png"), PNG_BYTES);
		// A sentinel ABOVE the markdown's directory, the traversal target.
		await Bun.write(join(adir, "secret.txt"), "top secret");
		// note2.md lives in `adir/inner`, so `secret.txt` (in `adir`) is OUTSIDE its
		// directory. A symlink INSIDE `inner` points at that secret: lexically
		// `leak.txt` is inside `inner`, but its realpath escapes → must 403.
		const innerDir = join(adir, "inner");
		const mdInner = join(innerDir, "note2.md");
		await Bun.write(mdInner, "# Inner\n");
		symlinkSync(join(adir, "secret.txt"), join(innerDir, "leak.txt"));
		const subdir = join(adir, "sub");
		await Bun.write(join(subdir, "doc.md"), "# Sub\n");
		await Bun.write(join(subdir, "img.png"), PNG_BYTES);
		asrv = await startServer({
			paths: [md, mdInner, join(subdir, "doc.md")],
			port: 0,
			theme: "auto",
			watch: false,
			recursive: false,
		});
		abase = `http://localhost:${asrv.port}`;
		id = fileIdFromPath(md);
		innerId = fileIdFromPath(mdInner);
	});

	afterAll(async () => {
		asrv.stop();
		await rm(adir, { recursive: true, force: true });
	});

	test("GET /assets/<id>/pic.png returns 200 with the exact bytes", async () => {
		const res = await fetch(`${abase}/assets/${id}/pic.png`);
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("no-cache");
		const bytes = new Uint8Array(await res.arrayBuffer());
		expect([...bytes]).toEqual([...PNG_BYTES]);
	});

	test("literal '../' is normalized away by URL parsing; the secret is not served", async () => {
		// Both fetch() and the server's `new URL(req.url).pathname` collapse a literal
		// `../` BEFORE the asset route matches, so the secret is never served (the
		// path falls through to the SPA shell). The percent-encoded variants below
		// survive normalization and exercise the actual server-side guard.
		const res = await fetch(`${abase}/assets/${id}/../secret.txt`);
		const body = await res.text();
		expect(body).not.toContain("top secret");
	});

	test("GET with percent-encoded traversal (%2e%2e) returns 403", async () => {
		const res = await fetch(`${abase}/assets/${id}/%2e%2e%2fsecret.txt`, { redirect: "manual" });
		expect(res.status).toBe(403);
	});

	test("GET with deep percent-encoded traversal to /etc/passwd returns 403", async () => {
		const res = await fetch(`${abase}/assets/${id}/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd`, { redirect: "manual" });
		expect(res.status).toBe(403);
	});

	test("GET /assets/<unknown-id>/pic.png returns 404", async () => {
		const res = await fetch(`${abase}/assets/f-deadbeef0000/pic.png`);
		expect(res.status).toBe(404);
	});

	test("GET /assets/<id>/missing.png returns 404", async () => {
		const res = await fetch(`${abase}/assets/${id}/missing.png`);
		expect(res.status).toBe(404);
	});

	test("GET /assets/<id>/sub (a directory) returns 404", async () => {
		// `sub` is a real directory next to note.md; serving a dir must 404.
		const res = await fetch(`${abase}/assets/${id}/sub`);
		expect(res.status).toBe(404);
	});

	test("GET /assets/<id>/<symlink-escaping-the-dir> returns 403 (realpath guard)", async () => {
		// `leak.txt` is a symlink inside note2.md's directory pointing at a file
		// above it; the lexical prefix check passes but the realpath check rejects.
		const res = await fetch(`${abase}/assets/${innerId}/leak.txt`, { redirect: "manual" });
		expect(res.status).toBe(403);
		const body = await res.text();
		expect(body).not.toContain("top secret");
	});
});

describe("startServer — onSessionChange", () => {
	let sdir: string;
	let ssrv: RunningServer | undefined;

	afterEach(async () => {
		ssrv?.stop();
		ssrv = undefined;
		if (sdir) await rm(sdir, { recursive: true, force: true });
	});

	test("fires on initial register and on POST /api/files with the current path set", async () => {
		sdir = await mkdtemp(join(tmpdir(), "clv-session-"));
		const a = join(sdir, "a.md");
		const b = join(sdir, "b.md");
		await Bun.write(a, "# A\n");
		await Bun.write(b, "# B\n");

		const calls: string[][] = [];
		ssrv = await startServer({
			paths: [a],
			port: 0,
			theme: "auto",
			watch: false,
			recursive: false,
			onSessionChange: (files) => calls.push(files),
		});

		// Initial register fired with just a.md.
		expect(calls).toHaveLength(1);
		expect(calls[0]).toEqual([a]);

		const res = await fetch(`http://localhost:${ssrv.port}/api/files`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ paths: [b] }),
		});
		expect(res.status).toBe(200);

		// POST fired again with both paths.
		expect(calls).toHaveLength(2);
		expect([...calls[1]!].sort()).toEqual([a, b].sort());
	});
});
