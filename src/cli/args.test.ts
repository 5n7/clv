import { describe, expect, test } from "bun:test";

import { type CliArgs, DEFAULT_PORT, parseCliArgs } from "./args";

// Parse argv and assert a "run" outcome, returning its args.
function run(argv: string[]): CliArgs {
	const o = parseCliArgs(argv);
	expect(o.kind).toBe("run");
	if (o.kind !== "run") throw new Error("expected a run outcome");
	return o.args;
}

describe("parseCliArgs — short-circuit flags", () => {
	test("--help / -h short-circuit to help", () => {
		expect(parseCliArgs(["--help"]).kind).toBe("help");
		expect(parseCliArgs(["-h"]).kind).toBe("help");
		// help wins even with other (including daemon) flags present.
		expect(parseCliArgs(["--__daemon", "--help"]).kind).toBe("help");
	});

	test("--version / -v short-circuit to version", () => {
		expect(parseCliArgs(["--version"]).kind).toBe("version");
		expect(parseCliArgs(["-v"]).kind).toBe("version");
	});

	test("doc as the first token short-circuits to doc", () => {
		expect(parseCliArgs(["doc"])).toEqual({ kind: "doc", block: undefined });
		expect(parseCliArgs(["doc", "callout"])).toEqual({ kind: "doc", block: "callout" });
		// Keyed on argv[0] only: `doc` elsewhere is not the subcommand.
		expect(parseCliArgs(["a.md", "doc"]).kind).toBe("run");
		expect(parseCliArgs(["--title", "doc"]).kind).toBe("run");
	});
});

describe("parseCliArgs — daemon control subcommands", () => {
	test("shutdown produces a shutdown outcome with the default port", () => {
		const o = parseCliArgs(["shutdown"]);
		expect(o).toEqual({ kind: "shutdown", port: DEFAULT_PORT });
	});

	test("shutdown --port parses the port", () => {
		const o = parseCliArgs(["shutdown", "--port", "9000"]);
		expect(o).toEqual({ kind: "shutdown", port: 9000 });
	});

	test("shutdown accepts both --port=9000 and --port 9000 forms (and the default)", () => {
		expect(parseCliArgs(["shutdown", "--port=9000"])).toEqual({ kind: "shutdown", port: 9000 });
		expect(parseCliArgs(["shutdown", "--port", "9000"])).toEqual({ kind: "shutdown", port: 9000 });
		expect(parseCliArgs(["shutdown"])).toEqual({ kind: "shutdown", port: DEFAULT_PORT });
	});

	test("status produces a status outcome with the parsed port", () => {
		expect(parseCliArgs(["status"])).toEqual({ kind: "status", port: DEFAULT_PORT });
		expect(parseCliArgs(["status", "--port", "8123"])).toEqual({ kind: "status", port: 8123 });
	});

	test("a bad --port for a control subcommand throws", () => {
		expect(() => parseCliArgs(["status", "--port", "0"])).toThrow();
		expect(() => parseCliArgs(["shutdown", "--port", "abc"])).toThrow();
	});

	test("the control verbs take no positional args (an extra positional is ignored)", () => {
		// Like `doc`, the daemon port comes via --port; `clv shutdown 9000` does NOT
		// set port 9000 — the positional is silently dropped, port stays the default.
		expect(parseCliArgs(["shutdown", "9000"])).toEqual({ kind: "shutdown", port: DEFAULT_PORT });
		expect(parseCliArgs(["status", "9000"])).toEqual({ kind: "status", port: DEFAULT_PORT });
	});

	test("the verbs are keyed on argv[0] only — same-named files still preview (no shadow)", () => {
		// Subcommand detection is an exact argv[0] match. A path that merely contains or
		// resembles the verb name (a `.md` file, a `./`-prefixed path) is a run path.
		const status = parseCliArgs(["status.md"]);
		expect(status.kind).toBe("run");
		if (status.kind === "run") expect(status.args.paths).toEqual(["status.md"]);

		const dotStatus = parseCliArgs(["./status"]);
		expect(dotStatus.kind).toBe("run");
		if (dotStatus.kind === "run") expect(dotStatus.args.paths).toEqual(["./status"]);

		const shutdown = parseCliArgs(["shutdown.md"]);
		expect(shutdown.kind).toBe("run");
		if (shutdown.kind === "run") expect(shutdown.args.paths).toEqual(["shutdown.md"]);
	});

	test("the old --status / --shutdown flags are removed (throw as unknown options)", () => {
		// Backward compat is intentionally dropped: the daemon control is verb-only now.
		// The retired flags must hit the run-path unknown-flag guard, not silently parse.
		expect(() => parseCliArgs(["--status"])).toThrow();
		expect(() => parseCliArgs(["--shutdown"])).toThrow();
	});
});

describe("parseCliArgs — hidden --__daemon entry", () => {
	test("produces a daemon outcome with port/theme/watch", () => {
		const o = parseCliArgs(["--__daemon", "--port", "7811", "--theme", "dark"]);
		expect(o).toEqual({ kind: "daemon", args: { port: 7811, theme: "dark", watch: true } });
	});

	test("defaults theme to auto and watch to on", () => {
		const o = parseCliArgs(["--__daemon", "--port", "7811"]);
		expect(o).toEqual({ kind: "daemon", args: { port: 7811, theme: "auto", watch: true } });
	});

	test("--no-watch turns watch off", () => {
		const o = parseCliArgs(["--__daemon", "--port", "7811", "--no-watch"]);
		expect(o).toEqual({ kind: "daemon", args: { port: 7811, theme: "auto", watch: false } });
	});

	test("an invalid theme throws", () => {
		expect(() => parseCliArgs(["--__daemon", "--theme", "neon"])).toThrow();
	});
});

describe("parseCliArgs — run outcome unchanged", () => {
	test("positional paths produce a run outcome with defaults", () => {
		const a = run(["a.md", "b.md"]);
		expect(a.paths).toEqual(["a.md", "b.md"]);
		expect(a.port).toBe(DEFAULT_PORT);
		expect(a.watch).toBe(true);
		expect(a.open).toBe(true);
	});

	test("--no-watch / --no-open / --recursive flow through", () => {
		const a = run(["docs", "--no-watch", "--no-open", "-R"]);
		expect(a.watch).toBe(false);
		expect(a.open).toBe(false);
		expect(a.recursive).toBe(true);
	});
});

describe("parseCliArgs — --group", () => {
	test("-g / --group set the group; undefined when absent (caller resolves auto)", () => {
		expect(run(["a.md", "-g", "design"]).group).toBe("design");
		expect(run(["a.md", "--group", "design"]).group).toBe("design");
		expect(run(["a.md"]).group).toBeUndefined();
	});

	test("a slash in the group name is allowed (owner/repo)", () => {
		expect(run(["a.md", "-g", "5n7/clv"]).group).toBe("5n7/clv");
	});

	test("the value is trimmed", () => {
		expect(run(["a.md", "--group=  design  "]).group).toBe("design");
	});

	test("a valueless -g / --group throws (cac yields boolean true)", () => {
		expect(() => parseCliArgs(["a.md", "-g"])).toThrow();
		expect(() => parseCliArgs(["a.md", "--group"])).toThrow();
	});

	test("an empty / whitespace-only group throws", () => {
		expect(() => parseCliArgs(["a.md", "--group="])).toThrow();
		expect(() => parseCliArgs(["a.md", "--group", "   "])).toThrow();
	});
});

describe("parseCliArgs — themeExplicit / watchExplicit", () => {
	test("both false when neither flag is present (defaults applied)", () => {
		const a = run(["a.md"]);
		expect(a.themeExplicit).toBe(false);
		expect(a.watchExplicit).toBe(false);
		// Defaults are unchanged.
		expect(a.theme).toBe("auto");
		expect(a.watch).toBe(true);
	});

	test("themeExplicit true only when --theme is present", () => {
		expect(run(["a.md", "--theme", "dark"]).themeExplicit).toBe(true);
		expect(run(["a.md"]).themeExplicit).toBe(false);
	});

	test("watchExplicit true for --watch and for --no-watch", () => {
		expect(run(["a.md", "--watch"]).watchExplicit).toBe(true);
		expect(run(["a.md", "--no-watch"]).watchExplicit).toBe(true);
		expect(run(["a.md"]).watchExplicit).toBe(false);
	});

	test("-w is a no-op alias and does NOT count as an explicit --watch", () => {
		const a = run(["a.md", "-w"]);
		expect(a.watch).toBe(true);
		expect(a.watchExplicit).toBe(false);
	});
});
