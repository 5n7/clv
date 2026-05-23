import type { Graph as GraphData } from "@shared/types";
import "@xyflow/react/dist/style.css";
import {
	Background,
	BackgroundVariant,
	Handle,
	type NodeProps,
	Position,
	ReactFlow,
	ReactFlowProvider,
} from "@xyflow/react";
import { useMemo } from "react";

import { BlockFrame } from "../components/BlockFrame";
import { buildGraph, type GraphNodeData, NODE_H, NODE_W } from "../lib/dagre";

type GraphProps = {
	data: GraphData;
	id?: string;
};

// Custom node: a single HTML pill styled by the design-system group classes
// (.gnode-html.api/.svc/.db/.ext). React Flow only owns position/transform; the
// pill's look is ours. Handles are hidden but present so edges anchor cleanly.
function GraphNode({ data }: NodeProps) {
	const d = data as GraphNodeData;
	return (
		<div className={"gnode-html " + (d.group || "")} style={{ width: NODE_W, height: NODE_H }}>
			<Handle type="target" position={Position.Left} isConnectable={false} />
			<span>{d.label}</span>
			<Handle type="source" position={Position.Right} isConnectable={false} />
		</div>
	);
}

const nodeTypes = { clv: GraphNode };

export function Graph({ data, id }: GraphProps) {
	const { nodes, edges } = useMemo(() => buildGraph(data), [data]);
	const direction = data.direction ?? "LR";
	const meta = `${direction} · ${data.nodes.length} nodes`;

	return (
		<BlockFrame type="graph" id={id} title={data.title} meta={meta} collapsed={data.collapsed}>
			<div className="graph graph-rf">
				<ReactFlowProvider>
					<ReactFlow
						nodes={nodes}
						edges={edges}
						nodeTypes={nodeTypes}
						fitView
						fitViewOptions={{ padding: 0.18 }}
						// Read as a diagram: panning/zoom stay enabled but nothing is editable.
						nodesDraggable={false}
						nodesConnectable={false}
						elementsSelectable={false}
						zoomOnDoubleClick={false}
						proOptions={{ hideAttribution: true }}
						minZoom={0.2}
						maxZoom={2}
					>
						<Background variant={BackgroundVariant.Dots} gap={18} size={1} />
					</ReactFlow>
				</ReactFlowProvider>
				<div className="glegend">
					<span>
						<span className="sw" style={{ background: "var(--info-bg)", borderColor: "var(--info)" }} />
						api
					</span>
					<span>
						<span className="sw" style={{ background: "var(--accent-2)", borderColor: "var(--accent)" }} />
						service
					</span>
					<span>
						<span className="sw" style={{ background: "var(--tip-bg)", borderColor: "var(--tip)" }} />
						db
					</span>
					<span>
						<span className="sw" style={{ background: "var(--bg-sunk)", borderColor: "var(--ink-3)" }} />
						external
					</span>
				</div>
			</div>
		</BlockFrame>
	);
}
