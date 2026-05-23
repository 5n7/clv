import type { CSSProperties } from "react";

import type { CodeToken } from "./shiki";

// Render one tokenized line as inline <span> runs, matching the prototype's
// renderCode output (a flat list of styled spans). An empty line renders a
// single space so the row keeps its height.
export function TokenLine({ tokens }: { tokens: CodeToken[] }) {
	if (tokens.length === 0 || (tokens.length === 1 && tokens[0]!.content === "")) {
		return <> </>;
	}
	return (
		<>
			{tokens.map((t, i) => (
				<span key={i} style={styleOf(t)}>
					{t.content}
				</span>
			))}
		</>
	);
}

// FontStyle bitmask from @shikijs/vscode-textmate: Italic=1, Bold=2,
// Underline=4, Strikethrough=8.
function styleOf(token: CodeToken): CSSProperties | undefined {
	const css: CSSProperties = {};
	if (token.color) css.color = token.color;
	const fs = token.fontStyle ?? 0;
	if (fs & 1) css.fontStyle = "italic";
	if (fs & 2) css.fontWeight = "bold";
	if (fs & 4) css.textDecoration = "underline";
	if (fs & 8) css.textDecoration = "line-through";
	return Object.keys(css).length ? css : undefined;
}
