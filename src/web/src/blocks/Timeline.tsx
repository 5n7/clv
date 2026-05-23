import type { Timeline as TimelineData } from "@shared/types";

import { BlockFrame } from "../components/BlockFrame";
import { Markdown } from "../lib/markdown";

// Numbered vertical-rail timeline: severity-tinted circular nodes threaded by a
// connecting rail. This is the accepted final design, not the earlier
// editorial-ladder iteration — do not revert.
type TimelineProps = {
	data: TimelineData;
	id?: string;
};

export function Timeline({ data, id }: TimelineProps) {
	const events = data.events || [];
	return (
		<BlockFrame type="timeline" id={id} title={data.title} meta={events.length + " phases"} collapsed={data.collapsed}>
			<ol className="tline">
				{events.map((e, i) => (
					<li key={i} className={"tline-row " + (e.kind || "info")}>
						<div className="tline-rail">
							<span className="tline-node">{String(i + 1).padStart(2, "0")}</span>
						</div>
						<div className="tline-body">
							<div className="tline-kicker">
								<span className="tline-at">{e.at}</span>
								<span className="tline-sep">·</span>
								<span className="tline-kind">{e.kind || "info"}</span>
							</div>
							<div className="tline-ttl">{e.title}</div>
							{e.body && (
								<div className="tline-desc">
									<Markdown>{e.body}</Markdown>
								</div>
							)}
						</div>
					</li>
				))}
			</ol>
		</BlockFrame>
	);
}
