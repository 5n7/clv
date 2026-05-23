import type { Chart as ChartData } from "@shared/types";
import type { CSSProperties } from "react";
import {
	Area,
	AreaChart,
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	Line,
	LineChart,
	Pie,
	PieChart,
	ResponsiveContainer,
	Scatter,
	ScatterChart,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

import { BlockFrame } from "../components/BlockFrame";

// Series palette, indexed by series position.
const CHART_COLORS = [
	"oklch(0.58 0.14 40)", // accent terracotta
	"oklch(0.55 0.13 240)", // blue
	"oklch(0.58 0.13 150)", // green
	"oklch(0.55 0.13 290)", // violet
	"oklch(0.65 0.13 80)", // amber
];

// Axis/grid styling references the design-system CSS vars so it follows theme.
// `tick` is an SVG <text> presentation-attribute object (not a CSS style object).
const axisLine = { stroke: "var(--line)" };
const tick = { fill: "var(--ink-3)", fontFamily: "var(--mono)", fontSize: 10 };
const tooltipStyle: CSSProperties = {
	background: "var(--bg-card)",
	border: "1px solid var(--line)",
	borderRadius: 8,
	fontFamily: "var(--mono)",
	fontSize: 12,
	color: "var(--ink)",
	boxShadow: "var(--shadow-sm)",
};

// recharts-backed chart. The legend is rendered as the EXTERNAL `.chart-legend`
// band (not recharts' inline <Legend>) so it matches the accepted design — a
// separate band above the plot with a top border. Series colors are indexed by
// yKey position so the legend swatches line up with the plotted series. Pie is
// the odd one out: it legends by row name (xKey) and colors per slice.
type ChartProps = {
	data: ChartData;
	id?: string;
};

export function Chart({ data, id }: ChartProps) {
	const series = data.yKeys || [];
	const rows = data.data || [];
	const height = data.height || 280;
	const isPie = data.type === "pie";

	const legend = isPie
		? rows.map((r, i) => ({ key: String(r[data.xKey]), idx: i }))
		: series.map((k, i) => ({ key: k, idx: i }));

	return (
		<BlockFrame
			type="chart"
			id={id}
			title={data.title}
			meta={`${data.type} · ${series.length} series`}
			collapsed={data.collapsed}
		>
			<div className="chart-legend">
				{legend.map(({ key, idx }) => (
					<span key={key} className="lg">
						<span className="sw" style={{ background: color(idx) }} />
						{key}
					</span>
				))}
			</div>
			<div className="chart-wrap" style={{ height }}>
				<ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
					{renderChart(data, series, rows)}
				</ResponsiveContainer>
			</div>
		</BlockFrame>
	);
}

function color(i: number): string {
	return CHART_COLORS[i % CHART_COLORS.length]!;
}

function renderChart(
	data: ChartData,
	series: string[],
	rows: Array<Record<string, string | number>>,
): React.ReactElement {
	const grid = <CartesianGrid stroke="var(--line-soft)" vertical={false} />;
	const xAxis = <XAxis dataKey={data.xKey} tick={tick} axisLine={axisLine} tickLine={false} />;
	const yAxis = <YAxis tick={tick} axisLine={false} tickLine={false} width={40} />;
	const tooltip = <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: "var(--line)" }} />;
	const stackId = data.stacked ? "a" : undefined;

	switch (data.type) {
		case "bar":
			return (
				<BarChart data={rows}>
					{grid}
					{xAxis}
					{yAxis}
					{tooltip}
					{series.map((k, i) => (
						<Bar key={k} dataKey={k} fill={color(i)} stackId={stackId} radius={[2, 2, 0, 0]} />
					))}
				</BarChart>
			);
		case "pie":
			return (
				<PieChart>
					{tooltip}
					<Pie data={rows} nameKey={data.xKey} dataKey={series[0]} innerRadius="45%" outerRadius="75%" paddingAngle={2}>
						{rows.map((_, i) => (
							<Cell key={i} fill={color(i)} />
						))}
					</Pie>
				</PieChart>
			);
		case "area":
			return (
				<AreaChart data={rows}>
					{grid}
					{xAxis}
					{yAxis}
					{tooltip}
					{series.map((k, i) => (
						<Area
							key={k}
							type="monotone"
							dataKey={k}
							stroke={color(i)}
							fill={color(i)}
							fillOpacity={0.12}
							strokeWidth={1.8}
							stackId={stackId}
						/>
					))}
				</AreaChart>
			);
		case "scatter":
			return (
				<ScatterChart>
					{grid}
					{xAxis}
					{yAxis}
					{tooltip}
					{series.map((k, i) => (
						<Scatter
							key={k}
							name={k}
							data={rows.map((r) => ({ [data.xKey]: r[data.xKey], [k]: r[k] }))}
							dataKey={k}
							fill={color(i)}
						/>
					))}
				</ScatterChart>
			);
		case "line":
		default:
			return (
				<LineChart data={rows}>
					{grid}
					{xAxis}
					{yAxis}
					{tooltip}
					{series.map((k, i) => (
						<Line
							key={k}
							type="monotone"
							dataKey={k}
							stroke={color(i)}
							strokeWidth={1.8}
							dot={{ r: 2.6, fill: "var(--bg-card)", stroke: color(i), strokeWidth: 1.6 }}
							activeDot={{ r: 4 }}
						/>
					))}
				</LineChart>
			);
	}
}
