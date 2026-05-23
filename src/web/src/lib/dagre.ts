import dagre from "@dagrejs/dagre";
import type { Graph as GraphData, GraphNode } from "@shared/types";
import type { Edge, Node } from "@xyflow/react";
import { MarkerType, Position } from "@xyflow/react";

// Fixed node box used both for the dagre layout pass and the rendered nodes.
export const NODE_W = 140;
export const NODE_H = 40;

export type GraphNodeData = {
	label: string;
	group: string;
};

// Map the spec's free-form `node.group` onto the four design-system classes
// (api / svc / db / ext). Anything unrecognized renders with the neutral base.
function groupClass(group: string | undefined): string {
	switch (group) {
		case "api":
			return "api";
		case "db":
			return "db";
		case "ext":
		case "external":
			return "ext";
		case "service":
		case "svc":
			return "svc";
		default:
			return group ?? "";
	}
}

// Honor explicit positions when the block opts into manual layout. GraphNode is
// extended (types.ts/schema.ts) with optional x/y for exactly this path.
function hasManualPositions(data: GraphData): boolean {
	return data.layout === "manual" && data.nodes.every((n) => typeof n.x === "number" && typeof n.y === "number");
}

export function buildGraph(data: GraphData): { nodes: Node[]; edges: Edge[] } {
	const direction = data.direction ?? "LR";
	const isHorizontal = direction !== "TB";

	const rfEdges: Edge[] = (data.edges ?? []).map((e, i) => ({
		id: `e${i}-${e.from}-${e.to}`,
		source: e.from,
		target: e.to,
		label: e.label || undefined,
		type: "default",
		markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "var(--ink-4)" },
		className: e.style === "dashed" ? "gedge-rf dashed" : "gedge-rf",
		labelStyle: { fill: "var(--ink-3)", fontFamily: "var(--mono)", fontSize: 10 },
		labelBgStyle: { fill: "var(--bg-card)", fillOpacity: 0.92 },
		labelBgPadding: [4, 2] as [number, number],
		labelBgBorderRadius: 3,
	}));

	const nodeBase = (n: GraphNode, x: number, y: number): Node => ({
		id: n.id,
		type: "clv",
		position: { x, y },
		data: { label: n.label, group: groupClass(n.group) } satisfies GraphNodeData,
		sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
		targetPosition: isHorizontal ? Position.Left : Position.Top,
		draggable: false,
		connectable: false,
		selectable: false,
		width: NODE_W,
		height: NODE_H,
	});

	// Manual layout: trust the given coordinates verbatim.
	if (hasManualPositions(data)) {
		const rfNodes = data.nodes.map((n) => nodeBase(n, n.x ?? 0, n.y ?? 0));
		return { nodes: rfNodes, edges: rfEdges };
	}

	// dagre (default) and "force" both fall through to dagre's layered layout.
	const g = new dagre.graphlib.Graph();
	g.setDefaultEdgeLabel(() => ({}));
	g.setGraph({ rankdir: direction, nodesep: 26, ranksep: 80, marginx: 8, marginy: 8 });

	for (const n of data.nodes) {
		g.setNode(n.id, { width: NODE_W, height: NODE_H });
	}
	for (const e of data.edges ?? []) {
		g.setEdge(e.from, e.to);
	}
	dagre.layout(g);

	const rfNodes = data.nodes.map((n) => {
		const p = g.node(n.id);
		// dagre centers nodes; React Flow positions by top-left.
		const x = (p?.x ?? 0) - NODE_W / 2;
		const y = (p?.y ?? 0) - NODE_H / 2;
		return nodeBase(n, x, y);
	});

	return { nodes: rfNodes, edges: rfEdges };
}
