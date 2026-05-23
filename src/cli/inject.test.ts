import type { Document } from "@shared/types";
import { describe, expect, test } from "bun:test";

import { injectInto } from "./inject-core";

// Synthetic template that reproduces the production hazard: the inlined module
// bundle contains a literal "</body></html>" STRING that appears BEFORE the real
// closing tags. A naive `replace("</body>", ...)` would match inside this string
// and split the bundle, prematurely closing the outer <script>.
const HAZARD_TEMPLATE = `<html><head><title>placeholder</title><script type="module">var x="</body></html>";console.log(1)</script></head><body><div id="root"></div></body></html>`;

function minimalDoc(overrides: Partial<Document> = {}): Document {
	return {
		title: "t",
		theme: "auto",
		nodes: [],
		...overrides,
	};
}

describe("injectInto — script-breakout regression (inject script-breakout bug)", () => {
	test('inserts the data script immediately after <div id="root"></div>, not inside the bundle string', () => {
		const html = injectInto(HAZARD_TEMPLATE, minimalDoc(), "");

		const anchor = `<div id="root"></div>`;
		const afterAnchor = html.slice(html.indexOf(anchor) + anchor.length);
		// The injected data script is the very next thing after the anchor.
		expect(afterAnchor.startsWith(`<script>window.__CLV_DATA__=`)).toBe(true);

		// The data script must NOT have been injected into the bundle's literal
		// string. The bundle string literal is unchanged.
		expect(html).toContain(`var x="</body></html>";console.log(1)`);
	});

	test('does not prematurely terminate the bundle <script type="module">', () => {
		const html = injectInto(HAZARD_TEMPLATE, minimalDoc(), "");

		const bundleStart = `<script type="module">`;
		const startIdx = html.indexOf(bundleStart);
		expect(startIdx).toBeGreaterThanOrEqual(0);

		// Substring from the bundle's opening tag to its FIRST following </script>.
		const closeIdx = html.indexOf("</script>", startIdx);
		const bundleElement = html.slice(startIdx, closeIdx);

		// If the bundle were cut off early (by an injected </script> or by a naive
		// </body> replace landing inside the string), `console.log(1)` would be lost.
		expect(bundleElement).toContain(`var x="</body></html>";console.log(1)`);
	});

	test("escapes literal </script> and </body> inside Document content so the data script is not broken", () => {
		const doc = minimalDoc({
			nodes: [
				{
					kind: "block",
					block: {
						type: "callout",
						data: {
							kind: "danger",
							// Content that, unescaped, would close the injected <script> early
							// and inject a stray </body>.
							body: "danger: </script><script>alert(1)</script> and </body> tags",
						},
					},
				},
			],
		});

		const html = injectInto(HAZARD_TEMPLATE, doc, "");

		// Locate the injected data segment.
		const marker = `window.__CLV_DATA__=`;
		const dataStart = html.indexOf(marker) + marker.length;
		const dataEnd = html.indexOf("</script>", dataStart);
		const jsonText = html.slice(dataStart, dataEnd);

		// The injected JSON escapes `</` as `<\/`, so the raw `</script>` / `</body>`
		// sequences never appear unescaped inside the data segment.
		expect(jsonText).toContain(`<\\/script>`);
		expect(jsonText).toContain(`<\\/body>`);
		expect(jsonText).not.toContain(`</script>`);
		expect(jsonText).not.toContain(`</body>`);

		// JSON.parse handles `\/` natively (valid JSON string escape), restoring the
		// original Document round-trip.
		const parsed = JSON.parse(jsonText);
		expect(parsed).toEqual(doc);
	});

	test("--title replacement does not interpret $`/$1/$$ replacement patterns", () => {
		// No &, <, > so escapeHtml is a no-op and the title survives verbatim. If
		// String.replace interpreted these as patterns, `$\`` (prefix), `$1`
		// (group), or `$$` (literal $) would mangle the output.
		const title = "$`prefix$1group$$dollar";
		const html = injectInto(HAZARD_TEMPLATE, minimalDoc(), title);

		expect(html).toContain(`<title>${title}</title>`);
		expect(html).not.toContain("placeholder");
	});

	test("--title containing $& is not interpreted as the whole-match pattern", () => {
		// `$&` would, if interpreted, expand to the matched <title>...</title>. The
		// only transform applied is escapeHtml: the `&` in `$&` becomes `&amp;`.
		const html = injectInto(HAZARD_TEMPLATE, minimalDoc(), "boom$&boom");

		expect(html).toContain(`<title>boom$&amp;boom</title>`);
		// If `$&` had been interpreted, the matched <title>placeholder</title> would
		// appear nested inside the new title.
		expect(html).not.toContain("placeholder");
	});

	test("--title with & < > is HTML-escaped", () => {
		const html = injectInto(HAZARD_TEMPLATE, minimalDoc(), "a & b <c>");

		expect(html).toContain(`<title>a &amp; b &lt;c&gt;</title>`);
	});
});

describe("injectInto — fallback path when the anchor is absent", () => {
	test('inserts before the LAST </body> when <div id="root"></div> is missing', () => {
		// Bundle string literal contains an early "</body>" that must be ignored.
		const noAnchor = `<html><head><script type="module">var s="</body>";console.log(2)</script></head><body>content</body></html>`;
		const html = injectInto(noAnchor, minimalDoc(), "");

		// The bundle's early literal </body> is preserved untouched.
		expect(html).toContain(`var s="</body>";console.log(2)`);

		// The data script lands right before the REAL (last) closing body tag.
		const lastBody = html.lastIndexOf("</body>");
		const before = html.slice(0, lastBody);
		expect(before.endsWith(`<script>window.__CLV_DATA__={"title":"t","theme":"auto","nodes":[]}</script>`)).toBe(true);
	});
});
