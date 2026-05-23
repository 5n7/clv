import { generateDiffFile } from "@git-diff-view/file";
import { DiffModeEnum, DiffView } from "@git-diff-view/react";
import type { Diff as DiffData } from "@shared/types";
import { useMemo, useState } from "react";

import { BlockFrame } from "../components/BlockFrame";
import { useTheme } from "../lib/useTheme";

// Real diff via @git-diff-view/react. We build the DiffFile from `from`/`to`
// via @git-diff-view/file's generateDiffFile (the lib computes the LCS diff itself),
// drive its theme from the active theme,
// and offer a split/unified toggle in BlockFrame's extraHead matching the
// prototype's segmented control. The lib's own highlighter (lowlight) is
// disabled to keep the bundle small; appearance is retargeted to the design
// tokens in styles/diff.css. Re-highlighting via shiki is out of scope for v0.1.
type DiffProps = {
	data: DiffData;
	id?: string;
};

export function Diff({ data, id }: DiffProps) {
	const theme = useTheme();
	const [mode, setMode] = useState<DiffModeEnum>(data.mode === "unified" ? DiffModeEnum.Unified : DiffModeEnum.Split);

	const fileName = data.file || "snippet";
	const lang = data.lang || "";

	const diffFile = useMemo(() => {
		const file = generateDiffFile(fileName, data.from || "", fileName, data.to || "", lang, lang);
		file.initTheme(theme);
		file.init();
		file.buildSplitDiffLines();
		file.buildUnifiedDiffLines();
		return file;
	}, [data.from, data.to, fileName, lang, theme]);

	const seg = (target: DiffModeEnum, label: string) => (
		<button className={"seg" + (mode === target ? " active" : "")} onClick={() => setMode(target)}>
			{label}
		</button>
	);

	return (
		<BlockFrame
			type="diff"
			id={id}
			title={data.title}
			collapsed={data.collapsed}
			meta={data.lang || ""}
			extraHead={
				<div className="diff-segs">
					{seg(DiffModeEnum.Split, "split")}
					{seg(DiffModeEnum.Unified, "unified")}
				</div>
			}
		>
			<div className="diff">
				<DiffView
					diffFile={diffFile}
					diffViewMode={mode}
					diffViewTheme={theme}
					diffViewHighlight={false}
					diffViewWrap={true}
					diffViewFontSize={12.5}
				/>
			</div>
		</BlockFrame>
	);
}
