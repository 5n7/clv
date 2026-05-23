import { describe, expect, test } from "bun:test";

import { injectServerConfig } from "./inject-server";

// Same hazard template used by inject.test.ts: a literal "</body></html>" string
// inside the bundle appears BEFORE the real closing tags.
const HAZARD_TEMPLATE = `<html><head><title>placeholder</title><script type="module">var x="</body></html>";console.log(1)</script></head><body><div id="root"></div></body></html>`;

describe("injectServerConfig", () => {
	test('injects the config script immediately after <div id="root"></div>', () => {
		const html = injectServerConfig(HAZARD_TEMPLATE, { apiBase: "/api" });

		const anchor = `<div id="root"></div>`;
		const afterAnchor = html.slice(html.indexOf(anchor) + anchor.length);
		expect(afterAnchor.startsWith(`<script>window.__CLV_SERVER__=`)).toBe(true);

		// The bundle string literal is left untouched.
		expect(html).toContain(`var x="</body></html>";console.log(1)`);
	});

	test("output contains __CLV_SERVER__ and not __CLV_DATA__", () => {
		const html = injectServerConfig(HAZARD_TEMPLATE, { apiBase: "/api" });
		expect(html).toContain("window.__CLV_SERVER__=");
		expect(html).not.toContain("__CLV_DATA__");
	});

	test("escapes literal </ in config values so the script tag is not broken", () => {
		const html = injectServerConfig(HAZARD_TEMPLATE, { apiBase: "/api", note: "</script><script>alert(1)</script>" });

		const marker = `window.__CLV_SERVER__=`;
		const dataStart = html.indexOf(marker) + marker.length;
		const dataEnd = html.indexOf("</script>", dataStart);
		const jsonText = html.slice(dataStart, dataEnd);

		expect(jsonText).toContain(`<\\/script>`);
		expect(jsonText).not.toContain(`</script>`);

		const parsed = JSON.parse(jsonText);
		expect(parsed).toEqual({ apiBase: "/api", note: "</script><script>alert(1)</script>" });
	});
});
