import type { Checklist as ChecklistData, Status } from "@shared/types";
import { useMemo } from "react";

import { BlockFrame } from "../components/BlockFrame";

const SYM: Record<Status, string> = { pass: "✓", fail: "✕", skip: "⤳", na: "–" };
const LBL: Record<Status, string> = { pass: "Pass", fail: "Fail", skip: "Skip", na: "N/A" };

type ChecklistProps = {
	data: ChecklistData;
	id?: string;
};

export function Checklist({ data, id }: ChecklistProps) {
	const items = data.items || [];

	const counts = useMemo(() => {
		const c: Record<Status, number> = { pass: 0, fail: 0, skip: 0, na: 0 };
		for (const i of items) c[i.status] = (c[i.status] || 0) + 1;
		return c;
	}, [items]);

	const total = counts.pass + counts.fail + counts.skip + counts.na || 1;
	const pct = (n: number) => ((n / total) * 100).toFixed(1) + "%";

	return (
		<BlockFrame type="checklist" id={id} title={data.title} collapsed={data.collapsed}>
			<div className="cklist">
				<div className="summ">
					<div className="bar" aria-label="status bar">
						{counts.pass > 0 && <span className="pass" style={{ width: pct(counts.pass) }} />}
						{counts.fail > 0 && <span className="fail" style={{ width: pct(counts.fail) }} />}
						{counts.skip > 0 && <span className="skip" style={{ width: pct(counts.skip) }} />}
						{counts.na > 0 && <span className="na" style={{ width: pct(counts.na) }} />}
					</div>
					<div className="nums">
						<span>
							<b>{counts.pass}</b> pass
						</span>
						<span>
							<b>{counts.fail}</b> fail
						</span>
						<span>
							<b>{counts.skip}</b> skip
						</span>
						<span>
							<b>{counts.na}</b> n/a
						</span>
					</div>
				</div>
				{items.map((it, i) => (
					<div className="row" key={i}>
						<span className={"ck " + it.status}>{SYM[it.status]}</span>
						<div>
							<div className="lbl">{it.label}</div>
							{it.note && <div className="note">{it.note}</div>}
						</div>
						<span className="stt">{LBL[it.status]}</span>
					</div>
				))}
			</div>
		</BlockFrame>
	);
}
