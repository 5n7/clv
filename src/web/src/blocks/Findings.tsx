import type { Finding, Findings as FindingsData, Severity } from "@shared/types";
import { useMemo, useState } from "react";

import { BlockFrame } from "../components/BlockFrame";
import { Icon, SEV_LABEL } from "../components/Icon";
import { useCodeIndex } from "../lib/codeIndex";
import { TokenLine } from "../lib/CodeTokens";
import { Markdown } from "../lib/markdown";
import { tokenizeLines } from "../lib/shiki";

const ORDER: Severity[] = ["critical", "danger", "warning", "tip", "info"];

// Severity → CSS color var for the group dot (note the var-name shift:
// warning→--warn, danger→--bad, critical→--crit).
const DOT_VAR: Record<Severity, string> = {
	critical: "var(--crit)",
	danger: "var(--bad)",
	warning: "var(--warn)",
	tip: "var(--tip)",
	info: "var(--info)",
};

type IndexedFinding = Finding & { ix: number };

// Severity-grouped accordion. Each finding expands in place to show the ±3-line
// snippet from the referenced `clv:code` block (target line highlighted) plus a
// separate `.snippet-note` card. Critical findings start expanded. The
// `# context` button jumps to the full code block (BlockFrame flashes on hash).
type FindingsProps = {
	data: FindingsData;
	id?: string;
};

export function Findings({ data, id }: FindingsProps) {
	const codeIndex = useCodeIndex();

	const groups = useMemo<Array<[Severity, IndexedFinding[]]>>(() => {
		const m = new Map<Severity, IndexedFinding[]>();
		(data.items || []).forEach((it, ix) => {
			const k = it.severity || "info";
			if (!m.has(k)) m.set(k, []);
			m.get(k)!.push({ ...it, ix });
		});
		return ORDER.filter((k) => m.has(k)).map((k) => [k, m.get(k)!]);
	}, [data.items]);

	const [openItems, setOpenItems] = useState<Record<number, boolean>>(() => {
		const o: Record<number, boolean> = {};
		(data.items || []).forEach((it, ix) => {
			o[ix] = it.severity === "critical";
		});
		return o;
	});
	const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
		Object.fromEntries(ORDER.map((k) => [k, true])),
	);

	const onJump = (blockId: string, ev: React.MouseEvent) => {
		ev.stopPropagation();
		// Re-trigger the hashchange flash even when already on this anchor.
		if (window.location.hash === "#" + blockId) {
			window.location.hash = "";
			setTimeout(() => {
				window.location.hash = "#" + blockId;
			}, 0);
		} else {
			window.location.hash = "#" + blockId;
		}
	};

	return (
		<BlockFrame type="findings" id={id} title={data.title} collapsed={data.collapsed}>
			<div className="findings">
				{groups.map(([sev, items]) => (
					<div className="grp" key={sev}>
						<button
							type="button"
							className="hdr"
							aria-expanded={openGroups[sev]}
							onClick={() => setOpenGroups((o) => ({ ...o, [sev]: !o[sev] }))}
						>
							<Icon name={openGroups[sev] ? "chevDown" : "chevRight"} size={14} />
							<span style={{ width: 10, height: 10, borderRadius: 3, background: DOT_VAR[sev] }} />
							<b>{SEV_LABEL[sev]}</b>
							<span className="ct">{items.length}</span>
						</button>
						{openGroups[sev] &&
							items.map((it) => {
								const open = !!openItems[it.ix];
								const code = it.blockId ? codeIndex[it.blockId] : undefined;
								const hasSnippet = !!(code && it.line != null);
								return (
									<div className={"item-wrap " + (open && hasSnippet ? "open" : "")} key={it.ix}>
										<div
											className="item"
											style={hasSnippet ? undefined : { cursor: "default" }}
											onClick={hasSnippet ? () => setOpenItems((o) => ({ ...o, [it.ix]: !o[it.ix] })) : undefined}
										>
											<span className={"sev " + sev} />
											<div>
												<div className="ttl">{it.title}</div>
												{(it.file || it.line != null) && (
													<div className="where">
														{it.file}
														{it.line != null ? ":" + it.line : ""}
													</div>
												)}
												{it.body && (
													<div className="body">
														<Markdown>{it.body}</Markdown>
													</div>
												)}
											</div>
											<div className="actions">
												{hasSnippet && (
													<span className="jump">
														<Icon name={open ? "chevDown" : "chevRight"} size={11} />
														{open ? "hide" : "show"} code
													</span>
												)}
												{it.blockId && (
													<button
														className="jump open-ctx"
														onClick={(e) => onJump(it.blockId!, e)}
														title="open full code block"
													>
														<Icon name="hash" size={11} /> context
													</button>
												)}
											</div>
										</div>
										{open && hasSnippet && <InlineSnippet blockId={it.blockId!} line={it.line!} severity={sev} />}
									</div>
								);
							})}
					</div>
				))}
			</div>
		</BlockFrame>
	);
}

// Renders the ±3-line slice around the finding's target line, highlighting that
// line and showing the matching annotation as the separate `.snippet-note` card.
type InlineSnippetProps = {
	blockId: string;
	line: number;
	severity: Severity;
};

function InlineSnippet({ blockId, line, severity }: InlineSnippetProps) {
	const codeIndex = useCodeIndex();
	const code = codeIndex[blockId];

	const tokenLines = useMemo(
		() => (code ? tokenizeLines(code.source || "", code.lang) : []),
		[code?.source, code?.lang],
	);

	if (!code) return null;

	const start = code.startLine || 1;
	const targetIdx = line - start;
	const ctx = 3;
	const from = Math.max(0, targetIdx - ctx);
	const to = Math.min(tokenLines.length, targetIdx + ctx + 1);
	const slice = tokenLines.slice(from, to);
	const ann = (code.annotations || []).find((a) => a.line === line);

	// The target line falls outside the referenced block's source range, so the
	// ±3-line slice is empty. Render a muted note instead of a broken empty <pre>
	// with a nonsensical range label; still surface a matching annotation if one
	// exists.
	if (slice.length === 0 || targetIdx < 0 || targetIdx >= tokenLines.length) {
		return (
			<div className="snippet-shell">
				<div className="snippet-oob">line {line} is outside the referenced snippet range</div>
				{ann && (
					<div className={"snippet-note " + (ann.kind || severity)}>
						<span className="note-label">{SEV_LABEL[ann.kind || severity]}</span>
						<span className="note-body">
							<Markdown>{ann.text}</Markdown>
						</span>
					</div>
				)}
			</div>
		);
	}

	return (
		<div className="snippet-shell">
			<div className="snippet">
				<div className="snippet-bar">
					<Icon name="file" size={11} />
					<span>{code.file}</span>
					<span className="rng">
						L{start + from}–L{start + to - 1}
					</span>
					<span style={{ flex: 1 }} />
					<span className="lang-pill">{code.lang}</span>
				</div>
				<pre>
					{slice.map((tokens, i) => {
						const lineNo = start + from + i;
						const isTarget = lineNo === line;
						return (
							<div key={i} className={"sn-ln " + (isTarget ? "target " + severity : "")}>
								<span className="num">{lineNo}</span>
								<span className="gut">{isTarget && <span className={"marker " + severity}>!</span>}</span>
								<span>
									<TokenLine tokens={tokens} />
								</span>
							</div>
						);
					})}
				</pre>
			</div>
			{ann && (
				<div className={"snippet-note " + (ann.kind || severity)}>
					<span className="note-label">{SEV_LABEL[ann.kind || severity]}</span>
					<span className="note-body">
						<Markdown>{ann.text}</Markdown>
					</span>
				</div>
			)}
		</div>
	);
}
