import bash from "@shikijs/langs/bash";
import go from "@shikijs/langs/go";
import javascript from "@shikijs/langs/javascript";
import json from "@shikijs/langs/json";
import jsx from "@shikijs/langs/jsx";
import markdown from "@shikijs/langs/markdown";
import python from "@shikijs/langs/python";
import sql from "@shikijs/langs/sql";
import tsx from "@shikijs/langs/tsx";
import typescript from "@shikijs/langs/typescript";
import { createHighlighterCoreSync, createCssVariablesTheme, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

// One shared synchronous shiki highlighter. We use `shiki/core` +
// `createHighlighterCoreSync` with the JS regex engine (no oniguruma WASM) so the
// highlighter is fully self-contained and small, and so blocks can highlight
// SYNCHRONOUSLY at render time (no async upgrade dance).
//
// Theme: a CSS-variables theme whose tokens emit `color: var(--shiki-...)`. Those
// vars are mapped to the design-system token colors (both light and dark) in
// tokens.css, so highlighting follows the active theme automatically.

export const SHIKI_THEME = "clv";

const cssTheme = createCssVariablesTheme({
	name: SHIKI_THEME,
	variablePrefix: "--shiki-",
	fontStyle: true,
});

export const highlighter: HighlighterCore = createHighlighterCoreSync({
	engine: createJavaScriptRegexEngine(),
	themes: [cssTheme],
	langs: [go, typescript, tsx, javascript, jsx, sql, json, bash, markdown, python],
});

// Languages the highlighter actually knows (incl. aliases). Anything else falls
// back to plain text rendering.
const LOADED = new Set(highlighter.getLoadedLanguages());

// Map common alias spellings used in clv docs to the loaded grammar name.
const LANG_ALIAS: Record<string, string> = {
	golang: "go",
	js: "javascript",
	md: "markdown",
	py: "python",
	sh: "bash",
	shell: "bash",
	ts: "typescript",
};

export type CodeToken = { content: string; color?: string; fontStyle?: number };

export function resolveLang(lang: string | undefined): string | null {
	if (!lang) return null;
	const l = lang.toLowerCase();
	const resolved = LANG_ALIAS[l] ?? l;
	return LOADED.has(resolved) ? resolved : null;
}

// Tokenize a single source string into per-line token arrays. For unknown
// languages we emit one plain token per line (no color), so callers can still
// render line-by-line with gutters/markers but without highlighting.
export function tokenizeLines(source: string, lang: string | undefined): CodeToken[][] {
	const resolved = resolveLang(lang);
	if (!resolved) {
		return source.split("\n").map((line) => [{ content: line }]);
	}
	return highlighter.codeToTokensBase(source, { lang: resolved, theme: SHIKI_THEME });
}

// Highlight a short inline snippet (e.g. a table cell) to tokens of a single line.
export function tokenizeInline(value: string, lang: string | undefined): CodeToken[] {
	const lines = tokenizeLines(value, lang);
	return lines.flat();
}
