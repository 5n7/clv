import type { Callout as CalloutData } from "@shared/types";

import { Icon } from "../components/Icon";
import { Markdown } from "../lib/markdown";

type CalloutProps = {
	data: CalloutData;
	id?: string;
};

// Rendered standalone (no BlockFrame) so the `.callout` card is the whole block.
export function Callout({ data, id }: CalloutProps) {
	const kind = data.kind || "info";
	return (
		<section
			id={id}
			className="block"
			style={{ padding: 0, background: "transparent", border: "none", boxShadow: "none" }}
		>
			<div className={"callout " + kind}>
				<div className="icn">
					<Icon name={kind} size={16} />
				</div>
				<div>
					{data.title && <div className="ttl">{data.title}</div>}
					<div className="body">
						<Markdown>{data.body}</Markdown>
					</div>
				</div>
			</div>
		</section>
	);
}
