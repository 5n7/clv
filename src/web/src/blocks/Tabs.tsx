import type { Tabs as TabsData } from "@shared/types";

import { BlockFrame } from "../components/BlockFrame";
import { Tabs as UiTabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Markdown } from "../lib/markdown";
import { BlockDispatcher } from "./dispatcher";

// Tabs over @radix-ui/react-tabs, styled with the design-system `.tabs` rules.
// Each tab renders either markdown `content` via the shared <Markdown>, or a
// nested `block` dispatched recursively.
//
// Known limitation (see README "Known limitations"): only the active tab is
// mounted, so a `# context` hash jump targeting a `clv:code` block nested in an
// inactive tab is a no-op until the user opens that tab. Not hash-aware by
// design — the inline finding snippet resolves code via the code index regardless.
type TabsProps = {
	data: TabsData;
	id?: string;
};

export function Tabs({ data, id }: TabsProps) {
	const tabs = data.tabs || [];
	if (tabs.length === 0) return null;

	return (
		<BlockFrame type="tabs" id={id} title={data.title} collapsed={data.collapsed}>
			<div className="tabs">
				<UiTabs defaultValue="0">
					<TabsList>
						{tabs.map((t, i) => (
							<TabsTrigger key={i} value={String(i)}>
								{t.label}
							</TabsTrigger>
						))}
					</TabsList>
					{tabs.map((t, i) => (
						<TabsContent key={i} value={String(i)}>
							{t.content && <Markdown>{t.content}</Markdown>}
							{t.block && <BlockDispatcher block={t.block} />}
						</TabsContent>
					))}
				</UiTabs>
			</div>
		</BlockFrame>
	);
}
