// Unknown block / parse-error renderer (SPEC §6.3). Ported from the prototype
// FallbackBlock in .design-reference/project/blocks-rel.jsx — red frame, an error
// line, and the raw fence text in a <pre>. Structure is intentionally flat (not
// wrapped in BlockFrame) so `.err` and `<pre>` sit directly under the section.
type FallbackProps = {
	blockType: string;
	raw: string;
	error: string;
};

export function Fallback({ blockType, raw, error }: FallbackProps) {
	return (
		<section className="block fallback">
			<header className="block-head">
				<span className="typetag">fallback</span>
				<span className="ttl">{blockType || "unknown block"}</span>
				<span className="spc" />
				<span className="meta" style={{ color: "var(--bad)" }}>
					render error
				</span>
			</header>
			<div className="err">
				<b>!</b>
				&nbsp;&nbsp;{error}
			</div>
			<pre>{raw}</pre>
		</section>
	);
}
