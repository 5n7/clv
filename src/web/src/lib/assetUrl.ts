import { createContext, useContext } from "react";
import { defaultUrlTransform } from "react-markdown";

// Relative-URL rewriting for serve mode. Markdown authored next to a `.md` file
// references images / links by relative path (`img.png`, `figs/deep.png`); the
// server serves those at `/assets/<fileId>/<relative-path>`. In static (self-
// contained) mode there is no server, so URLs are left untouched (identity) —
// react-markdown's built-in `defaultUrlTransform` still sanitizes them.

// Present in serve mode (carries the active file id), absent (null) in static
// mode. Consumed by the shared `Markdown` renderer via `useAssetRewrite`.
export const AssetBaseContext = createContext<{ fileId: string } | null>(null);

// PURE. First sanitize EXACTLY like static mode by running `url` through
// react-markdown's `defaultUrlTransform` (the sanitizer it would otherwise apply
// when no `urlTransform` is supplied). It neutralizes dangerous schemes —
// `javascript:`, `vbscript:`, `data:`, … — by returning `""`. Because serve mode
// passes this function AS react-markdown's `urlTransform`, it REPLACES that
// default sanitizer, so we must invoke it ourselves or `javascript:` links would
// render unsanitized on the localhost origin (XSS / same-origin data access).
//
// Only AFTER it passes do we additionally rebase relative paths. Left untouched:
//   - safe absolute scheme (http/https/mailto/…): `defaultUrlTransform` keeps it
//   - protocol-relative: `//cdn/x`
//   - root-absolute path: `/x`
//   - bare anchor: `#section`
//   - empty string
// Everything else is treated as relative and rebased to `/assets/<fileId>/<rel>`
// (a leading `./` is stripped; `../` is passed through and the server's path
// guard 403s any escape).
export function rewriteRelativeUrl(url: string, fileId: string): string {
	const safe = defaultUrlTransform(url);
	if (safe === "") return "";

	if (safe.startsWith("#")) return safe;
	if (safe.startsWith("//")) return safe;
	if (safe.startsWith("/")) return safe;
	if (/^[a-z][a-z0-9+.-]*:/i.test(safe)) return safe;

	const rel = safe.startsWith("./") ? safe.slice(2) : safe;
	return `/assets/${fileId}/${rel}`;
}

// Returns a URL transformer bound to the active file in serve mode, or
// `undefined` when no provider is present (static mode). Returning `undefined`
// — rather than an identity function — lets react-markdown keep its built-in
// `defaultUrlTransform` sanitizer, so static-mode rendering is truly unchanged.
export function useAssetRewrite(): ((url: string) => string) | undefined {
	const ctx = useContext(AssetBaseContext);
	if (!ctx) return undefined;
	const { fileId } = ctx;
	return (url) => rewriteRelativeUrl(url, fileId);
}
