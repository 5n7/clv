import type { Code as CodeData } from "@shared/types";
import { Fragment, useMemo } from "react";

import { BlockFrame } from "../components/BlockFrame";
import { Icon, SEV_LABEL } from "../components/Icon";
import { TokenLine } from "../lib/CodeTokens";
import { Markdown } from "../lib/markdown";
import { tokenizeLines } from "../lib/shiki";

type CodeProps = {
	data: CodeData;
	id?: string;
};

export function Code({ data, id }: CodeProps) {
	const start = data.startLine || 1;
	const lines = useMemo(() => tokenizeLines(data.source || "", data.lang), [data.source, data.lang]);

	const annByLine = useMemo(() => {
		const m = new Map<number, NonNullable<CodeData["annotations"]>>();
		for (const a of data.annotations || []) {
			if (!m.has(a.line)) m.set(a.line, []);
			m.get(a.line)!.push(a);
		}
		return m;
	}, [data.annotations]);

	const hl = useMemo(() => new Set(data.highlightLines || []), [data.highlightLines]);
	const annCount = (data.annotations || []).length;

	return (
		<BlockFrame type="code" id={id} title={data.title} meta={data.lang} collapsed={data.collapsed}>
			<div className="codeblk">
				<div className="filebar">
					<Icon name="file" size={13} />
					<span>{data.file || "snippet"}</span>
					<span className="lang">{data.lang}</span>
					<span className="spc" />
					<span className="annn">
						{annCount} annotation{annCount === 1 ? "" : "s"}
					</span>
				</div>
				<pre>
					{lines.map((tokens, idx) => {
						const lineNo = start + idx;
						const anns = annByLine.get(lineNo);
						const sev = anns?.[0]?.kind;
						const cls = "ln" + (anns ? " has-ann" : "") + (hl.has(lineNo) ? " hl" : "");
						return (
							<Fragment key={idx}>
								<div className={cls}>
									<span className="num">{lineNo}</span>
									<span className="gut">{sev && <span className={"marker " + sev}>!</span>}</span>
									<span className="code">
										<TokenLine tokens={tokens} />
									</span>
								</div>
								{anns?.map((a, j) => (
									<div key={"a" + j} className={"ann " + (a.kind || "info")}>
										<b>{SEV_LABEL[a.kind || "info"]}:</b> <Markdown>{a.text}</Markdown>
									</div>
								))}
							</Fragment>
						);
					})}
				</pre>
			</div>
		</BlockFrame>
	);
}
