import { VERSION } from "@shared/version";
import cac from "cac";

export { VERSION };

export const DEFAULT_PORT = 7421;

export type CliArgs = {
	// All positional input paths. The static/export path uses `paths[0]`; serve
	// mode uses the full list.
	paths: string[];
	// Serve-mode listen port (default 7421).
	port: number;
	// Serve-mode: watch registered files/dirs and live-reload. Default ON.
	watch: boolean;
	// Whether `--watch`/`--no-watch` appeared in argv (vs the default). Used like
	// `themeExplicit` to warn only on an explicit connect-time mismatch.
	watchExplicit: boolean;
	// Serve-mode: recurse into subdirectories when a directory is given.
	recursive: boolean;
	// Serve-mode sidebar group for the registered files. `undefined` means the user
	// did not pass `-g`/`--group`, so the server resolves the auto group per-file
	// (each file by its own repo's GitHub owner/repo, else "default").
	group?: string;
	theme: "auto" | "light" | "dark";
	// Whether `--theme` appeared in argv (vs the default). The serve flow uses this
	// to decide whether to warn on a connect-time mismatch with a running daemon.
	themeExplicit: boolean;
	output?: string;
	open: boolean;
	title: string;
	strict: boolean;
};

// Sentinel returns for the short-circuit outcomes so index.ts can dispatch each
// without treating them as errors. `shutdown`/`status` are daemon-control verb
// subcommands. `daemon` is the hidden detached-process entry (spawned with the
// `--__daemon` flag, NOT registered as a cac option, so it stays out of the
// auto-generated help). Detection precedence lives in parseCliArgs.
export type ParseOutcome =
	| { kind: "help" }
	| { kind: "version" }
	// `doc` prints clv format help to stdout: the full showcase (no block) or one
	// block's schema + worked example (`doc <block>`). Learn the format.
	| { kind: "doc"; block?: string }
	| { kind: "daemon"; args: { port: number; theme: "auto" | "light" | "dark"; watch: boolean } }
	| { kind: "shutdown"; port: number }
	| { kind: "status"; port: number }
	| { kind: "run"; args: CliArgs };

// Build the configured cac instance. Both parseCliArgs (outcome detection) and
// printHelp (auto-generated help) call this so the option/command list and the
// help text never drift apart.
//
// cac wiring: all options are declared GLOBALLY (before the commands) so they are
// shared across both commands' parsing — that's what keeps `--title doc` from
// misrouting the value `doc` to the `doc` command. The default command is the
// variadic `[...paths]` (matchedCommandName === undefined when it matches); the
// `doc [block]` command matches only when argv[0] is literally `doc`. Descriptions
// carry the defaults in prose rather than via cac's `{ default }` config, which
// would alter parsed values and worsen the negated-option `(default: true)` quirk.
function buildCli() {
	const cli = cac("clv");
	// The `doc`/`status`/`shutdown` verbs shadow same-named files: a file literally
	// named `doc`, `status`, or `shutdown` is matched as the subcommand, not previewed.
	// Use `./doc` or `clv doc.md` (and likewise for the others) to preview such a file.
	// `status`/`shutdown` take no positional args (the daemon port comes via --port);
	// an extra positional like `clv shutdown 9000` is silently ignored, same as `doc`.
	cli.command("[...paths]", "Markdown files or directories to preview. Reads stdin when omitted.");
	cli.command("doc [block]", "Print clv format help to stdout: the full showcase, or one block's schema + example.");
	cli.command("status", "Show the running clv daemon (port, pid, files) and exit.");
	cli.command("shutdown", "Stop the running clv daemon and exit.");
	// Live preview (default mode).
	cli.option("--port <number>", "clv daemon port. Default: 7421.");
	cli.option("-w, --watch", "Watch files and live-reload. Default: on.");
	cli.option("--no-watch", "Disable file watching / live-reload.");
	cli.option("-R, --recursive", "Recurse into subdirectories when a directory is given.");
	cli.option(
		"-g, --group <name>",
		`Group files under <name> in the sidebar. Default: each file's GitHub owner/repo, else "default".`,
	);
	cli.option("--no-open", "Do not auto-launch the browser.");
	// Static export (--output mode).
	cli.option("--output <path>", "Write a self-contained HTML file to <path> instead of serving.");
	cli.option("--title <string>", `HTML <title> for static export. Default: "clv".`);
	cli.option("--strict", "With --output: exit 1 if any block fails validation.");
	// Appearance (both modes).
	cli.option("--theme <auto|light|dark>", "Color scheme. Default: auto.");
	// NOTE: `--__daemon` is intentionally NOT registered. Leaving it unregistered keeps
	// it OUT of the auto-generated help, yet (because we parse with `{ run: false }`,
	// which skips cac's unknown-option check) options.__daemon is still populated for the
	// daemon short-circuit below.
	cli.help();
	cli.version(VERSION);
	cli.example("clv review.md");
	cli.example("clv -R docs/");
	cli.example("clv spec.md -g design");
	cli.example("clv doc callout");
	cli.example("clv status");
	cli.example(`claude -p "review this PR" | clv --output out.html`);
	return cli;
}

export function parseCliArgs(argv: string[]): ParseOutcome {
	const cli = buildCli();
	// Suppress cac's parse-time help/version printing (registering .help()/.version()
	// sets showHelpOnExit/showVersionOnExit = true, and cac prints during parse() even
	// with { run: false }). We keep parseCliArgs pure and detect the flags ourselves;
	// printHelp() does the actual help output.
	cli.showHelpOnExit = false;
	cli.showVersionOnExit = false;

	// cac slices the FIRST TWO argv elements (node + script), so prepend two dummies.
	// `{ run: false }` keeps command actions from firing AND disables cac's own
	// checkUnknownOptions — letting the hidden `--__daemon` flag pass through. We
	// re-implement unknown-flag rejection ourselves on the run path (see below).
	const { args, options } = cli.parse(["", "", ...argv], { run: false });

	// Outcome precedence: help and version win first so they short-circuit even
	// alongside other flags (e.g. `--__daemon --help` → help).
	if (options.help || options.h) return { kind: "help" };
	if (options.version || options.v) return { kind: "version" };

	// Verb subcommands: keyed on argv[0] (cac's matchedCommandName). For `doc`, `args`
	// is already command-name-sliced, so args[0] is the optional block name (or
	// undefined). `status`/`shutdown` take no positional args (port comes via --port);
	// any extra positional is silently ignored, the same as `doc`. A file literally
	// named `doc`/`status`/`shutdown` is therefore shadowed — use `./doc` or `clv doc.md`.
	if (cli.matchedCommandName === "doc") return { kind: "doc", block: args[0] };
	if (cli.matchedCommandName === "shutdown") return { kind: "shutdown", port: resolvePort(options.port) };
	if (cli.matchedCommandName === "status") return { kind: "status", port: resolvePort(options.port) };

	// Hidden daemon entrypoint. Checked AFTER the verb subcommands: the daemon is
	// spawned with no subcommand (just `--__daemon ...`), so matchedCommandName is
	// undefined and can never collide with the verbs above.
	// Bracket access: `--__daemon` is the exact (dangling-underscore) cac key, and
	// string-literal indexing keeps it out of the no-underscore-dangle lint.
	if (options["__daemon"]) {
		return {
			kind: "daemon",
			args: { port: resolvePort(options.port), theme: parseTheme(options.theme ?? "auto"), watch: options.watch },
		};
	}

	// Reject unknown flags on the run path. `{ run: false }` skips cac's own
	// checkUnknownOptions, and cac/mri would otherwise SWALLOW a typo'd long flag AND
	// consume the following token as its value (e.g. `clv --watc review.md` → zero
	// paths → silent stdin wait), so we reject them strictly here. The short-circuits
	// above (help/version/doc/status/shutdown/daemon) intentionally bypass this check.
	// `--__daemon` is the hidden internal flag — unregistered by design, so allow it.
	const unknown = Object.keys(options).find((k) => k !== "--" && k !== "__daemon" && !cli.globalCommand.hasOption(k));
	if (unknown !== undefined) {
		throw new Error(`unknown option "${unknown.length > 1 ? `--${unknown}` : `-${unknown}`}"`);
	}

	// "Explicit" = the user actually typed the flag. cac gives options.watch/options.open
	// an automatic default of `true` (a side effect of declaring --no-watch/--no-open),
	// so they are ALWAYS present — explicitness can't be read from `options` and is read
	// from the raw `argv` instead. `-w` is a documented no-op alias and is NOT counted as
	// an explicit --watch (test pins this).
	const themeExplicit = argv.includes("--theme");
	const watchExplicit = argv.includes("--no-watch") || argv.includes("--watch");

	// cac yields boolean `true` for a valueless `--output`/`--title`; coerce to a real
	// string (or undefined/the default) so the typed CliArgs never carries a boolean.
	const output = typeof options.output === "string" ? options.output : undefined;

	return {
		kind: "run",
		args: {
			paths: [...args],
			port: resolvePort(options.port),
			// options.watch: true by default / for --watch, false for --no-watch.
			watch: options.watch,
			watchExplicit,
			recursive: Boolean(options.recursive),
			group: validateGroup(options.group),
			theme: parseTheme(options.theme ?? "auto"),
			themeExplicit,
			output,
			// When --output is given we never auto-open (per SPEC §3 CLI options table).
			// options.open is true unless --no-open.
			open: options.open && !output,
			title: typeof options.title === "string" ? options.title : "clv",
			strict: Boolean(options.strict),
		},
	};
}

// Print cac's auto-generated help to stdout. Used by index.ts for the `help` outcome.
// A freshly built, un-parsed cli has no matchedCommand, so outputHelp() prints the
// full global help.
export function printHelp(): void {
	buildCli().outputHelp();
}

// Validate and narrow a raw --theme value. Loosely typed because cac yields boolean
// `true` for a valueless `--theme` (correctly rejected here, like any other non-enum).
function parseTheme(theme: unknown): "auto" | "light" | "dark" {
	if (theme !== "auto" && theme !== "light" && theme !== "dark") {
		throw new Error(`invalid --theme "${theme}" (expected auto | light | dark)`);
	}
	return theme;
}

// Validate and narrow a raw --group value. `undefined` (flag absent) is passed
// through so the caller resolves the auto group. cac yields boolean `true` for a
// valueless `-g`/`--group` (rejected here, mirroring validatePort). The value is
// trimmed; an empty/whitespace-only value is rejected. No shell-injection
// validation: the group never reaches a shell, it only labels the sidebar.
function validateGroup(raw: unknown): string | undefined {
	if (raw === undefined) return undefined;
	if (typeof raw !== "string") {
		throw new Error(`invalid --group "${raw}" (expected a name)`);
	}
	const trimmed = raw.trim();
	if (!trimmed) {
		throw new Error(`invalid --group "${raw}" (expected a non-empty name)`);
	}
	return trimmed;
}

// Parse a raw --port value into a positive integer. Throws on a bad value. The input
// is loosely typed because cac yields a number for a numeric port, a string for a
// non-numeric one, and boolean `true` for a valueless `--port` — the latter MUST be
// rejected (not coerced via Number(true) === 1, which would silently misconfigure).
function validatePort(raw: unknown): number {
	if (typeof raw !== "string" && typeof raw !== "number") {
		throw new Error(`invalid --port "${raw}" (expected a positive integer)`);
	}
	const port = Number(raw);
	if (!Number.isInteger(port) || port <= 0) {
		throw new Error(`invalid --port "${raw}" (expected a positive integer)`);
	}
	return port;
}

// Resolve cac's --port option to a port number, defaulting when absent. Throws on a
// bad value (validatePort enforces a positive integer).
function resolvePort(port: unknown): number {
	return port === undefined ? DEFAULT_PORT : validatePort(port);
}
