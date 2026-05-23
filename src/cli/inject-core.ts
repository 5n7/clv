import type { Document } from "@shared/types";

// Pure HTML-injection core, decoupled from the dist template import so it can be
// unit-tested with a synthetic template (no build required). `inject.ts` wraps
// this with the real `dist/template.html` text import.

// Serialize a value as JSON safe to embed inside a <script> tag: escape any
// literal `</` sequence (notably `</script>`) which would otherwise close the
// tag early. `\/` is a valid JSON string escape, so JSON.parse restores the
// original on the page.
export function jsonScriptLiteral(value: unknown): string {
	return JSON.stringify(value).replace(/<\//g, "<\\/");
}

// Insert a classic <script> tag immediately after the `<div id="root"></div>`
// anchor, which is unique and minification-stable. A classic <script> runs
// synchronously during HTML parse, so it is set before the deferred
// `type="module"` app bundle reads it. We must NOT naively replace the first
// `</body>`: the inlined bundle (mermaid → DOMPurify) contains a literal
// "</body>" string before the real closing tag, and injecting there would split
// the bundle mid-string and break the page.
export function insertAfterRootAnchor(html: string, tag: string): string {
	const rootAnchor = `<div id="root"></div>`;
	if (html.includes(rootAnchor)) {
		return html.replace(rootAnchor, `${rootAnchor}${tag}`);
	}
	// Fallback: insert before the REAL closing body tag (the last one — earlier
	// occurrences may be string literals inside the inlined bundle).
	const bodyIdx = html.lastIndexOf("</body>");
	if (bodyIdx !== -1) {
		return html.slice(0, bodyIdx) + tag + html.slice(bodyIdx);
	}
	// Last resort: append (should not happen for our template).
	return html + tag;
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function injectInto(template: string, doc: Document, title: string): string {
	let html = template;

	if (title) {
		// Function-form replacement so `$&`, `$1`, `$$` etc. in the title are NOT
		// interpreted as replacement patterns.
		html = html.replace(/<title>.*?<\/title>/i, () => `<title>${escapeHtml(title)}</title>`);
	}

	const tag = `<script>window.__CLV_DATA__=${jsonScriptLiteral(doc)}</script>`;
	return insertAfterRootAnchor(html, tag);
}
