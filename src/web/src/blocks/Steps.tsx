import type { Steps as StepsData } from "@shared/types";
import { useCallback, useState } from "react";

import { BlockFrame } from "../components/BlockFrame";
import { Icon } from "../components/Icon";
import { Markdown } from "../lib/markdown";
import { BlockDispatcher } from "./dispatcher";

// Step player ported from blocks-rel.jsx. Prev/Next buttons + keyboard (←/→/Space)
// + dots indicator. Keyboard nav is SCOPED to real focus inside the block: the
// handler lives on the focusable root via onKeyDown, so it only intercepts
// Space/Arrows when the user has focused the block (no window listener — hovering
// must not hijack page scroll). No autoplay (SPEC §7.14).
//
// Known limitation (see README "Known limitations"): only the current step is
// mounted, so a `# context` hash jump targeting a `clv:code` block nested in a
// non-current step is a no-op until the user advances to that step.
type StepsProps = {
	data: StepsData;
	id?: string;
};

export function Steps({ data, id }: StepsProps) {
	const steps = data.steps || [];
	const n = steps.length;
	const clampInitial = Math.min(Math.max(data.initial ?? 0, 0), Math.max(n - 1, 0));
	const [i, setI] = useState(clampInitial);

	const goNext = useCallback(() => setI((v) => Math.min(v + 1, n - 1)), [n]);
	const goPrev = useCallback(() => setI((v) => Math.max(v - 1, 0)), []);

	const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
		if (e.key === "ArrowRight" || e.key === " ") {
			e.preventDefault();
			goNext();
		} else if (e.key === "ArrowLeft") {
			e.preventDefault();
			goPrev();
		}
	};

	if (n === 0) return null;
	const cur = steps[i];

	return (
		<BlockFrame type="steps" id={id} title={data.title} collapsed={data.collapsed}>
			<div className="steps" tabIndex={0} onKeyDown={onKeyDown}>
				<div className="ctrl">
					<button onClick={goPrev} disabled={i === 0} aria-label="previous step">
						<Icon name="chevLeft" size={14} />
					</button>
					<button onClick={goNext} disabled={i === n - 1} aria-label="next step">
						<Icon name="chevRight" size={14} />
					</button>
					<span className="ix">
						{String(i + 1).padStart(2, "0")} / {String(n).padStart(2, "0")}
					</span>
					<div className="dots">
						{steps.map((_, k) => (
							<span key={k} className={dotClass(k, i)} />
						))}
					</div>
					<div className="kbd">
						<span>←</span>
						<span>→</span>
						<span>space</span>
					</div>
				</div>
				<div className="pane">
					<div className="stt">{cur?.title}</div>
					{cur?.body && (
						<div className="stsub">
							<Markdown>{cur.body}</Markdown>
						</div>
					)}
					{cur?.block && <BlockDispatcher block={cur.block} />}
				</div>
			</div>
		</BlockFrame>
	);
}

// Dot indicator class for step `k` relative to the current step `i`.
function dotClass(k: number, current: number): string {
	if (k === current) return "cur";
	if (k < current) return "done";
	return "";
}
