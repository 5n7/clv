import { Children, Fragment, isValidElement, type ReactNode, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { CopyButton } from "../components/CopyButton";
import { useAssetRewrite } from "./assetUrl";
import { TokenLine } from "./CodeTokens";
import { tokenizeLines } from "./shiki";

// Allowlist for rehype-sanitize, extending the default GitHub schema so our own
// trusted markup survives the cleanup while raw HTML stays safe (scripts, event
// handlers, `javascript:` URLs and inline `style` are still stripped).
const schema = {
	...defaultSchema,
	tagNames: [...(defaultSchema.tagNames ?? []), "kbd"], // allow the <kbd> demo
	attributes: {
		...defaultSchema.attributes,
		// `className` must survive sanitize so: the remark-math placeholder
		// `<span class="math math-inline">` is still found by rehype-katex (which
		// runs AFTER sanitize), the shiki `<code class="language-*">` reaches our
		// `code` component override, and remark-gfm's `task-list-item` class is kept.
		"*": [...(defaultSchema.attributes?.["*"] ?? []), "className"],
	},
};

// One shiki-highlighted fenced block, rendered as the full `<pre><code>` pair
// (not just `<code>`) so we can host the hover-revealed CopyButton inside the
// positioned `<pre>` — the button sits outside `<code>` so it never lands in
// the copied text. The `.code-fence` class is the `position: relative` anchor.
// Memoized on (src, lang) so unrelated re-renders of the enclosing Markdown
// don't re-tokenize, matching the block renderers (Code.tsx, Findings.tsx).
function HighlightedCode({ className, lang, src }: { className?: string; lang: string | undefined; src: string }) {
	const lines = useMemo(() => tokenizeLines(src, lang), [src, lang]);
	return (
		<pre className="code-fence">
			<CopyButton text={src} className="fence-copy" />
			<code className={className}>
				{lines.map((tokens, i) => (
					<Fragment key={i}>
						<TokenLine tokens={tokens} />
						{i < lines.length - 1 ? "\n" : null}
					</Fragment>
				))}
			</code>
		</pre>
	);
}

// Detect a fenced code block that our `code` override replaced with a
// `HighlightedCode` element (which emits its own <pre class="code-fence">). The
// child here is that element, carrying the forwarded `className="language-*"`.
// Used by the `pre` override to avoid wrapping it in a second react-markdown
// `<pre>`.
function isFencedChild(children: ReactNode): boolean {
	const first = Children.toArray(children)[0];
	if (!isValidElement(first)) return false;
	const cls = (first.props as { className?: string }).className;
	return typeof cls === "string" && cls.includes("language-");
}

// Syntax-highlight FENCED CODE BLOCKS with the shared shiki helper. The `code`
// override already emits the full `<pre class="code-fence"><code>…` pair for
// fenced blocks (so it can host the CopyButton), so the `pre` override must
// pass that through untouched — otherwise react-markdown's default `<pre>` would
// double-wrap it. A plain raw `<pre>` (from rehype-raw) has no `language-*`
// child, so it keeps the standard `<pre>` rendering and stays intact.
const components: Components = {
	pre({ children, node: _node, ...rest }) {
		if (isFencedChild(children)) return <>{children}</>;
		return <pre {...rest}>{children}</pre>;
	},
	code({ className, children, node: _node, ...rest }) {
		const match = /language-([\w-]+)/.exec(className || "");
		if (match) {
			const src = String(children ?? "").replace(/\n$/, "");
			return <HighlightedCode className={className} lang={match[1]} src={src} />;
		}
		// Inline code, or a fence with no language: default rendering. Do not
		// forward `node` onto the DOM element.
		return (
			<code className={className} {...rest}>
				{children}
			</code>
		);
	},
};

// Shared markdown renderer. Output is scoped under `.md`, whose descendant
// selectors in blocks.css style headings/p/code/a/lists/tables/quotes/etc. via
// the design system. Fenced code is shiki-highlighted, and math (remark-math +
// rehype-katex), raw inline HTML (rehype-raw), and heading ids (rehype-slug)
// are enabled. Raw HTML is allowlist-sanitized via rehype-sanitize (scripts,
// event handlers, `javascript:` URLs and inline `style` are stripped) before
// slug/katex run, so trusted markup (math placeholders, shiki classes, GFM
// task-list classes) survives while injection is blocked. Reuse this anywhere a
// markdown field is rendered (prose nodes, block bodies, findings, etc.).
export function Markdown({ children, className }: { children: string; className?: string }) {
	// In serve mode this rebases relative img/href onto `/assets/<fileId>/…`. In
	// static mode it is `undefined`, so react-markdown keeps its built-in
	// `defaultUrlTransform` sanitizer — static rendering stays unchanged. The
	// serve-mode rewriter runs that same `defaultUrlTransform` sanitizer FIRST
	// (dangerous schemes like `javascript:` are neutralized exactly as in static
	// mode) and only then rebases relative paths; serve-mode asset access is
	// additionally guarded server-side.
	const rewrite = useAssetRewrite();
	return (
		<div className={className ? `md ${className}` : "md"}>
			<ReactMarkdown
				remarkPlugins={[remarkGfm, remarkMath]}
				rehypePlugins={[rehypeRaw, [rehypeSanitize, schema], rehypeSlug, rehypeKatex]}
				components={components}
				urlTransform={rewrite}
			>
				{children}
			</ReactMarkdown>
		</div>
	);
}
