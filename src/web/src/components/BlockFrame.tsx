import { type ReactNode, useEffect, useRef, useState } from "react";

import { cn } from "../lib/utils";
import { Icon } from "./Icon";

export type BlockFrameProps = {
	type: string;
	id?: string;
	title?: string;
	meta?: ReactNode;
	collapsed?: boolean;
	extraHead?: ReactNode;
	fallback?: boolean;
	children?: ReactNode;
};

export function BlockFrame({
	type,
	id,
	title,
	meta,
	collapsed: collapsedInit,
	extraHead,
	fallback,
	children,
}: BlockFrameProps) {
	const [collapsed, setCollapsed] = useState(!!collapsedInit);
	const ref = useRef<HTMLElement>(null);

	// Anchor flash + scroll when the URL hash points at this block.
	useEffect(() => {
		if (!id) return;
		const onHash = () => {
			if (window.location.hash === "#" + id) {
				ref.current?.classList.add("flash");
				ref.current?.scrollIntoView({ block: "start", behavior: "smooth" });
				setTimeout(() => ref.current?.classList.remove("flash"), 1400);
			}
		};
		window.addEventListener("hashchange", onHash);
		if (window.location.hash === "#" + id) onHash();
		return () => window.removeEventListener("hashchange", onHash);
	}, [id]);

	return (
		<section ref={ref} id={id} className={cn("block", collapsed && "collapsed", fallback && "fallback")}>
			{(title || type) && (
				<header className="block-head">
					<span className="typetag">{type}</span>
					{title && <span className="ttl">{title}</span>}
					<span className="spc" />
					{meta && <span className="meta">{meta}</span>}
					{extraHead}
					<button className="fold" onClick={() => setCollapsed((v) => !v)} aria-label="collapse">
						<Icon name={collapsed ? "chevRight" : "chevDown"} size={14} />
					</button>
				</header>
			)}
			<div className="block-body">{children}</div>
		</section>
	);
}
