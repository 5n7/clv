import { describe, expect, test } from "bun:test";

import { type CliArgs, parseCliArgs } from "./args";

// Parse argv and assert a "run" outcome, returning its args.
function run(argv: string[]): CliArgs {
	const o = parseCliArgs(argv);
	expect(o.kind).toBe("run");
	if (o.kind !== "run") throw new Error("expected a run outcome");
	return o.args;
}

// Edges introduced by the cac migration that the existing suite does not pin:
// the `--port=` equals form on the run path, and an unknown flag after `doc`.
describe("parseCliArgs — cac migration edges", () => {
	test("--port=9000 (equals form) parses on the run path", () => {
		// args.test.ts only covers the space form (`--port 9000`) on the run path;
		// the equals form goes through cac/mri differently and is unpinned there.
		expect(run(["a.md", "--port=9000"]).port).toBe(9000);
	});

	test("a flag after `doc` is not treated as the block", () => {
		// `args[0]` is cac's command-name-sliced positional; an unknown flag after
		// the subcommand must not be picked up as the block name.
		expect(parseCliArgs(["doc", "--foo"])).toEqual({ kind: "doc", block: undefined });
	});

	test("a valueless --port throws instead of silently becoming port 1", () => {
		// cac yields boolean `true` for `--port` with no value; `Number(true) === 1`
		// would silently misconfigure the port, so validatePort must reject the boolean.
		expect(() => parseCliArgs(["a.md", "--port"])).toThrow();
		expect(() => parseCliArgs(["a.md", "--port", "-1"])).toThrow();
		expect(() => parseCliArgs(["shutdown", "--port"])).toThrow();
	});

	test("a valueless --output/--title never leaks a boolean into CliArgs", () => {
		// cac yields `true` for the valueless forms; CliArgs must stay string-typed.
		const a = run(["a.md", "--output", "--title"]);
		expect(a.output).toBeUndefined();
		expect(a.title).toBe("clv");
	});

	test("an unknown flag on the run path throws (not swallowed)", () => {
		// cac/mri would otherwise eat the following token as the flag's value and drop
		// the path silently; the run-path guard restores the old parseArgs strictness.
		expect(() => parseCliArgs(["--watc", "review.md"])).toThrow();
		expect(() => parseCliArgs(["a.md", "--bogus"])).toThrow();
	});

	test("unknown flags are tolerated on the short-circuit paths (matches old parser)", () => {
		// help/doc/shutdown short-circuit before the run-path unknown-flag guard, so an
		// extra unknown flag there does not error (the original parser behaved the same).
		// The `shutdown` verb short-circuits on argv[0] just like `doc`, so the bogus
		// flag that follows it never reaches the unknown-flag guard.
		expect(parseCliArgs(["--help", "--bogus"]).kind).toBe("help");
		expect(parseCliArgs(["doc", "--bogus"])).toEqual({ kind: "doc", block: undefined });
		expect(parseCliArgs(["shutdown", "--bogus"]).kind).toBe("shutdown");
	});
});
