import { describe, expect, test } from "bun:test";

import { rewriteRelativeUrl } from "./assetUrl";

const ID = "f-abc123";

describe("rewriteRelativeUrl", () => {
	test("leaves absolute http(s) URLs untouched", () => {
		expect(rewriteRelativeUrl("http://x/y.png", ID)).toBe("http://x/y.png");
		expect(rewriteRelativeUrl("https://x/y.png", ID)).toBe("https://x/y.png");
	});

	test("leaves mailto: URLs untouched", () => {
		expect(rewriteRelativeUrl("mailto:a@b.com", ID)).toBe("mailto:a@b.com");
	});

	test("neutralizes dangerous schemes exactly like static mode", () => {
		// react-markdown's defaultUrlTransform (which serve mode now runs first)
		// blocks these by returning "". data: is NOT in its allowlist either.
		expect(rewriteRelativeUrl("javascript:alert(1)", ID)).toBe("");
		expect(rewriteRelativeUrl("JAVASCRIPT:alert(1)", ID)).toBe("");
		expect(rewriteRelativeUrl("vbscript:msgbox(1)", ID)).toBe("");
		expect(rewriteRelativeUrl("data:image/png;base64,AAAA", ID)).toBe("");
	});

	test("leaves protocol-relative URLs untouched", () => {
		expect(rewriteRelativeUrl("//cdn/x.png", ID)).toBe("//cdn/x.png");
	});

	test("leaves root-absolute paths untouched", () => {
		expect(rewriteRelativeUrl("/x.png", ID)).toBe("/x.png");
	});

	test("leaves bare anchors untouched", () => {
		expect(rewriteRelativeUrl("#section", ID)).toBe("#section");
	});

	test("leaves the empty string untouched", () => {
		expect(rewriteRelativeUrl("", ID)).toBe("");
	});

	test("rewrites a bare relative file name", () => {
		expect(rewriteRelativeUrl("img.png", ID)).toBe(`/assets/${ID}/img.png`);
	});

	test("rewrites a nested relative path", () => {
		expect(rewriteRelativeUrl("figs/deep.png", ID)).toBe(`/assets/${ID}/figs/deep.png`);
	});

	test("strips a leading ./", () => {
		expect(rewriteRelativeUrl("./img.png", ID)).toBe(`/assets/${ID}/img.png`);
	});

	test("passes ../ through (server enforces the boundary)", () => {
		expect(rewriteRelativeUrl("../up.png", ID)).toBe(`/assets/${ID}/../up.png`);
	});
});
