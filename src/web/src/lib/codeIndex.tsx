import type { Code, Document } from "@shared/types";
import { walkBlocks } from "@shared/walk";
import { createContext, type ReactNode, useContext, useMemo } from "react";

// Lookup of every `clv:code` block in the document keyed by its `id`, so the
// findings renderer can pull inline ±3-line snippets without a window global.
// Built once in App.tsx (from the parsed Document) and provided via context.
export type CodeIndex = Record<string, Code>;

const CodeIndexContext = createContext<CodeIndex>({});

export function buildCodeIndex(doc: Document): CodeIndex {
	const index: CodeIndex = {};
	for (const node of doc.nodes) {
		if (node.kind === "block") {
			walkBlocks(node.block, (b) => {
				if (b.type === "code" && b.data.id) index[b.data.id] = b.data;
			});
		}
	}
	return index;
}

export function CodeIndexProvider({ doc, children }: { doc: Document; children: ReactNode }) {
	const index = useMemo(() => buildCodeIndex(doc), [doc]);
	return <CodeIndexContext.Provider value={index}>{children}</CodeIndexContext.Provider>;
}

export function useCodeIndex(): CodeIndex {
	return useContext(CodeIndexContext);
}
