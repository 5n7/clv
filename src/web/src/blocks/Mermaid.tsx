import type { Mermaid as MermaidData } from "@shared/types";
import mermaid from "mermaid";
import { useEffect, useId, useState } from "react";

import { BlockFrame } from "../components/BlockFrame";
import { useTheme } from "../lib/useTheme";

type MermaidProps = {
	data: MermaidData;
	id?: string;
};

export function Mermaid({ data, id }: MermaidProps) {
	const theme = useTheme();
	const reactId = useId();
	const renderId = "mmd-" + reactId.replace(/[^a-zA-Z0-9]/g, "");
	const [svg, setSvg] = useState<string>("");
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		configureMermaid(theme);
		mermaid
			.render(renderId, data.source || "")
			.then((result) => {
				if (!cancelled) {
					setSvg(result.svg);
					setError(null);
				}
			})
			.catch((e: unknown) => {
				if (!cancelled) setError(e instanceof Error ? e.message : String(e));
			});
		return () => {
			cancelled = true;
		};
	}, [data.source, theme, renderId]);

	return (
		<BlockFrame type="mermaid" id={id} title={data.title} meta="mermaid" collapsed={data.collapsed}>
			<div className="mermaid">
				{error ? (
					<pre style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--bad)" }}>{error}</pre>
				) : (
					<div dangerouslySetInnerHTML={{ __html: svg }} />
				)}
			</div>
		</BlockFrame>
	);
}

// Real mermaid, bundled INLINE (no async chunk). We render via mermaid.render()
// in an effect and inject the returned SVG, keeping the prototype's dotted-grid
// `.mermaid` wrapper. Re-renders on theme change. We theme mermaid's "base"
// theme to the design tokens where feasible.
//
// NOTE: mermaid reads oklch()/var() CSS values poorly for some computed colors;
// we pass concrete-ish token references and let it fall back gracefully. The
// dotted-grid wrapper and surrounding chrome stay on-brand regardless.
function configureMermaid(theme: "light" | "dark"): void {
	mermaid.initialize({
		startOnLoad: false,
		securityLevel: "strict",
		theme: "base",
		fontFamily: "var(--mono)",
		themeVariables: {
			background: "transparent",
			primaryColor: theme === "dark" ? "#2a2f3a" : "#ffffff",
			primaryTextColor: theme === "dark" ? "#e8e6e1" : "#26303f",
			primaryBorderColor: theme === "dark" ? "#4a5160" : "#d8d2c8",
			lineColor: theme === "dark" ? "#9aa0ad" : "#7a8190",
			secondaryColor: theme === "dark" ? "#32384a" : "#f3eee8",
			tertiaryColor: theme === "dark" ? "#262b35" : "#faf7f2",
			noteBkgColor: theme === "dark" ? "#3a3320" : "#fbf5e3",
			noteTextColor: theme === "dark" ? "#e8e6e1" : "#26303f",
			noteBorderColor: theme === "dark" ? "#7a6a2a" : "#d9c98a",
		},
	});
}
