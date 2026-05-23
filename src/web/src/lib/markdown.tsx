import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useAssetRewrite } from "./assetUrl";

// Shared markdown renderer. Output is scoped under `.md`, whose descendant
// selectors in blocks.css style h2/h3/p/code/a/ul/li/strong/em via the design
// system. Reuse this anywhere a markdown field is rendered (prose nodes, block
// bodies, findings, etc.).
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
			<ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={rewrite}>
				{children}
			</ReactMarkdown>
		</div>
	);
}
