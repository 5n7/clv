import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Markdown } from "./markdown";

// Render the shared Markdown component to a static HTML string. `useAssetRewrite`
// returns undefined without a context provider, i.e. static mode — no DOM needed.
function render(md: string): string {
	return renderToStaticMarkup(<Markdown>{md}</Markdown>);
}

describe("Markdown shiki highlighting", () => {
	test("highlights a fenced rust block", () => {
		const html = render("```rust\nfn main() {}\n```");
		expect(html).toContain("language-rust");
		expect(html).toContain('style="color:');
	});

	test("highlights a fenced yaml block", () => {
		const html = render("```yaml\nkey: value\n```");
		expect(html).toContain("language-yaml");
		expect(html).toContain('style="color:');
	});

	test("renders an unknown-language fence plainly without throwing", () => {
		const html = render("```nonexistentlang\nsome text\n```");
		expect(html).toContain("some text");
	});

	test("wraps a fenced block in a single code-fence <pre> with a copy button", () => {
		const html = render("```rust\nfn main() {}\n```");
		expect(html).toContain('class="code-fence"');
		// The copy button lives inside the <pre> but outside <code>.
		expect(html).toContain("copybtn");
		// No double <pre>: only one opening <pre> tag total.
		expect(html.match(/<pre/g)?.length).toBe(1);
	});
});

describe("Markdown math", () => {
	test("renders inline math via katex", () => {
		const html = render("$E = mc^2$");
		expect(html).toContain("katex");
	});

	test("renders display math via katex-display", () => {
		const html = render("$$\nx^2\n$$");
		expect(html).toContain("katex-display");
	});
});

describe("Markdown raw HTML allowlist", () => {
	test("keeps an allowed <kbd> element", () => {
		const html = render("<kbd>Esc</kbd>");
		expect(html).toContain("<kbd>");
	});
});

describe("Markdown sanitize (security)", () => {
	test("strips an inline event handler", () => {
		const html = render('<img src=x onerror="alert(1)">');
		expect(html).not.toContain("onerror");
	});

	test("strips a <script> element", () => {
		const html = render("<script>alert(1)</script>");
		expect(html).not.toContain("<script");
	});

	test("strips a javascript: link", () => {
		const html = render("[x](javascript:alert(1))");
		expect(html).not.toContain("javascript:");
	});
});

describe("Markdown GFM", () => {
	test("renders a table", () => {
		const html = render("| a | b |\n| - | - |\n| 1 | 2 |");
		expect(html).toContain("<table");
	});

	test("renders task-list checkboxes with the task-list-item class", () => {
		const html = render("- [x] done\n- [ ] todo");
		expect(html).toContain("<input");
		expect(html).toContain("task-list-item");
	});

	test("renders strikethrough", () => {
		const html = render("~~x~~");
		expect(html).toContain("<del");
	});

	test("renders a footnote section", () => {
		const html = render("text[^1]\n\n[^1]: note");
		expect(html).toMatch(/footnotes|data-footnote/);
	});
});
