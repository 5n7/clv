import type { Block } from "@shared/types";

// Depth-first walk over a block and its recursive children (tabs[].block /
// steps[].block). `visit` runs once per block, parents before children.
export function walkBlocks(block: Block, visit: (block: Block) => void): void {
	visit(block);
	if (block.type === "tabs") {
		for (const tab of block.data.tabs) {
			if (tab.block) walkBlocks(tab.block, visit);
		}
	} else if (block.type === "steps") {
		for (const step of block.data.steps) {
			if (step.block) walkBlocks(step.block, visit);
		}
	}
}
