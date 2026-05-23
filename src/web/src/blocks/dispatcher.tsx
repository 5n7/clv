import type { Block } from "@shared/types";

import { Callout } from "./Callout";
import { Chart } from "./Chart";
import { Checklist } from "./Checklist";
import { Code } from "./Code";
import { Diff } from "./Diff";
import { Fallback } from "./Fallback";
import { Findings } from "./Findings";
import { Graph } from "./Graph";
import { Mermaid } from "./Mermaid";
import { Metrics } from "./Metrics";
import { Steps } from "./Steps";
import { Table } from "./Table";
import { Tabs } from "./Tabs";
import { Timeline } from "./Timeline";
import { Tree } from "./Tree";

// Central block dispatcher. Maps each of the 14 SPEC §7 block types to its
// renderer; an unknown tag (only reachable for nested blocks that bypassed the
// CLI parser) falls back to a raw-JSON render. Lives in its own module so
// recursive blocks (Tabs/Steps) can dispatch nested blocks without a circular
// import through blocks/index.tsx.
type BlockDispatcherProps = {
	block: Block;
};

export function BlockDispatcher({ block }: BlockDispatcherProps) {
	const id = block.data.id;
	switch (block.type) {
		case "callout":
			return <Callout data={block.data} id={id} />;
		case "chart":
			return <Chart data={block.data} id={id} />;
		case "checklist":
			return <Checklist data={block.data} id={id} />;
		case "code":
			return <Code data={block.data} id={id} />;
		case "diff":
			return <Diff data={block.data} id={id} />;
		case "findings":
			return <Findings data={block.data} id={id} />;
		case "graph":
			return <Graph data={block.data} id={id} />;
		case "mermaid":
			return <Mermaid data={block.data} id={id} />;
		case "metrics":
			return <Metrics data={block.data} id={id} />;
		case "steps":
			return <Steps data={block.data} id={id} />;
		case "table":
			return <Table data={block.data} id={id} />;
		case "tabs":
			return <Tabs data={block.data} id={id} />;
		case "timeline":
			return <Timeline data={block.data} id={id} />;
		case "tree":
			return <Tree data={block.data} id={id} />;
		default: {
			// Unreachable for top-level blocks (parser emits a fallback node), but a
			// nested block (tabs/steps) could carry an unknown tag in dev data.
			const unknownBlock = block as { type: string; data: unknown };
			return (
				<Fallback
					blockType={"clv:" + unknownBlock.type}
					raw={JSON.stringify(unknownBlock.data, null, 2)}
					error="Unknown block type"
				/>
			);
		}
	}
}
