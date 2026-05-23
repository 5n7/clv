import type { Metrics as MetricsData, Trend } from "@shared/types";

import { BlockFrame } from "../components/BlockFrame";

const TREND_CH: Record<Trend, string> = { up: "▲", down: "▼", neutral: "•" };

type MetricsProps = {
	data: MetricsData;
	id?: string;
};

export function Metrics({ data, id }: MetricsProps) {
	const cols = data.columns || 4;
	return (
		<BlockFrame type="metrics" id={id} title={data.title} collapsed={data.collapsed}>
			<div className={"metrics c" + cols}>
				{(data.items || []).map((m, i) => {
					const trend = m.trend || "neutral";
					return (
						<div className="metric" key={i}>
							<div className="l">{m.label}</div>
							<div className="v">
								<span>{m.value}</span>
								{m.delta && (
									<span className={"d " + trend}>
										{TREND_CH[trend]} {m.delta}
									</span>
								)}
							</div>
							{m.hint && <div className="h">{m.hint}</div>}
						</div>
					);
				})}
			</div>
		</BlockFrame>
	);
}
