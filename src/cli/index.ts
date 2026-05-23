#!/usr/bin/env bun
import type { FileEntry } from "@shared/types";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { type CliArgs, parseCliArgs, printHelp, VERSION } from "./args";
import { decideShutdownAction, findOrSpawnDaemon, probeStatus, runDaemonMain } from "./daemon";
import { runDoc } from "./doc";
import { inject } from "./inject";
import { openInBrowser } from "./open";
import { pickOpenId } from "./open-target";
import { parseDocument } from "./parse";
import { clearState, readState } from "./state";

async function readInput(file: string | undefined): Promise<string> {
	if (file) {
		try {
			return await Bun.file(file).text();
		} catch {
			console.error(`clv: cannot read input file: ${file}`);
			process.exit(1);
		}
	}
	// No file arg: read Markdown from stdin.
	return new Response(Bun.stdin.stream()).text();
}

// Serve pipeline: find or spawn the background daemon, register the requested
// paths into it, print the URL, open the browser, and EXIT immediately. The
// daemon keeps running detached — the parent must not block.
async function runServe(args: CliArgs): Promise<void> {
	// Validate the inputs exist before touching the daemon (mirrors readInput's
	// error). `existsSync` accepts both files and directories (directory inputs
	// are expanded to their `.md` files by the daemon).
	for (const p of args.paths) {
		if (!existsSync(p)) {
			console.error(`clv: path not found: ${p}`);
			process.exit(1);
		}
	}

	const { port, spawned, status } = await findOrSpawnDaemon({
		port: args.port,
		theme: args.theme,
		watch: args.watch,
	});

	// Connecting to an EXISTING daemon: its theme/watch are fixed for its lifetime,
	// so an explicit --theme/--watch that disagrees is silently ignored. Surface
	// that — but only when the user explicitly passed the flag AND it differs from
	// the running daemon's reported value. No notice when it matches or wasn't given.
	if (!spawned && status) {
		if (args.themeExplicit && status.theme !== undefined && status.theme !== args.theme) {
			console.error(
				`clv: daemon already running with theme="${status.theme}"; --theme "${args.theme}" ignored (run 'clv shutdown' to change)`,
			);
		}
		if (args.watchExplicit && status.watch !== undefined && status.watch !== args.watch) {
			console.error(
				`clv: daemon already running with watch=${status.watch}; --${args.watch ? "watch" : "no-watch"} ignored (run 'clv shutdown' to change)`,
			);
		}
	}

	const resolved = args.paths.map((p) => resolve(p));
	const res = await fetch(`http://localhost:${port}/api/files`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ paths: resolved, recursive: args.recursive }),
	});
	if (!res.ok) {
		console.error(`clv: failed to register files (HTTP ${res.status})`);
		process.exit(1);
	}
	const entries = (await res.json()) as FileEntry[];

	// Open to a file matching the args (exact file, or a file under a dir arg);
	// falls back to the first registered entry when nothing matches.
	const targetId = pickOpenId(entries, resolved);
	const url = `http://localhost:${port}/` + (targetId ? `?file=${targetId}` : "");

	console.log(`clv: serving at ${url}`);

	if (args.open) {
		await openInBrowser(url);
	}
	// Daemon keeps running detached; return so main() exits 0.
}

// Static/export pipeline (unchanged): parse a single input (file or stdin) into
// a self-contained HTML page, write it, and optionally open it. --strict and
// stdin behavior are preserved here.
async function runStatic(args: CliArgs): Promise<void> {
	const input = args.paths[0];
	const markdown = await readInput(input);

	// `source` labels the document in the UI. Default to "stdin" so the rail and
	// breadcrumb never show "undefined" when piping (SPEC §10 fix).
	const source = input ?? "stdin";

	const { doc, hadError } = parseDocument(markdown, {
		title: args.title,
		theme: args.theme,
		source,
	});

	const html = inject(doc, args.title);

	const outPath = args.output ?? join(tmpdir(), `clv-${Date.now()}.html`);
	// Create parent dirs for an explicit --output path if they don't exist.
	if (args.output) {
		await mkdir(dirname(outPath), { recursive: true });
	}
	await Bun.write(outPath, html);

	// Strict mode: the HTML is still written so the bad output can be inspected,
	// but we exit non-zero and skip launching the browser (SPEC §10).
	if (args.strict && hadError) {
		console.error("clv: block validation failed (--strict)");
		process.exit(1);
	}

	if (args.output) {
		// Explicit output: report the path, never open the browser.
		console.log(outPath);
	} else if (args.open) {
		await openInBrowser(outPath);
	} else {
		// --no-open without --output: tell the user where it landed.
		console.log(outPath);
	}
}

// `clv shutdown`: stop a running daemon (POST /api/shutdown). Idempotent — prints a
// notice when nothing is running.
async function runShutdown(port: number): Promise<void> {
	const st = readState();
	const candidate = st?.port ?? port;
	const status = await probeStatus(candidate, 500);
	if (decideShutdownAction(st, status) === "no-op") {
		// Nothing of ours is running (unreachable, or a stranger holds the port).
		// Drop any stale state so the next run starts clean.
		clearState();
		console.log("clv: no daemon running");
		return;
	}
	try {
		await fetch(`http://localhost:${candidate}/api/shutdown`, {
			method: "POST",
			signal: AbortSignal.timeout(1000),
		});
	} catch {
		// The daemon may close the connection as it exits; that's expected.
	}
	console.log("clv: daemon stopped");
}

// `clv status`: print a concise summary of the running daemon, or a notice.
async function runStatusCmd(port: number): Promise<void> {
	const st = readState();
	const candidate = st?.port ?? port;
	const status = await probeStatus(candidate, 500);
	if (!status?.clv) {
		console.log("clv: no daemon running");
		return;
	}
	// theme/watch are appended only when the daemon reports them (older daemons
	// predate these fields and omit them — don't print `undefined`).
	let line = `clv: daemon running — port ${status.port}, pid ${status.pid}, version ${status.version}, files ${status.files}`;
	if (status.theme !== undefined) line += `, theme ${status.theme}`;
	if (status.watch !== undefined) line += `, watch ${status.watch ? "on" : "off"}`;
	console.log(line);
}

async function main(): Promise<void> {
	const outcome = parseCliArgs(Bun.argv.slice(2));
	switch (outcome.kind) {
		case "help":
			printHelp();
			return;
		case "version":
			console.log(VERSION);
			return;
		case "doc":
			runDoc(outcome.block);
			return;
		case "daemon":
			// Detached daemon entry: start the long-lived server and stay alive (do not
			// return — Bun.serve keeps the event loop running).
			await runDaemonMain(outcome.args);
			return;
		case "shutdown":
			await runShutdown(outcome.port);
			return;
		case "status":
			await runStatusCmd(outcome.port);
			return;
		case "run": {
			const args = outcome.args;
			// Serve (daemon flow) when positional paths are given and --output is NOT set.
			// Otherwise (explicit --output, or stdin with no paths) take the static export
			// path, which is unchanged.
			if (args.paths.length > 0 && !args.output) {
				if (args.strict) {
					console.error("clv: --strict only applies to --output (static export); ignored in live preview mode.");
				}
				await runServe(args);
				return;
			}
			await runStatic(args);
			return;
		}
	}
}

main().catch((err: unknown) => {
	console.error(`clv: ${err instanceof Error ? err.message : String(err)}`);
	process.exit(1);
});
