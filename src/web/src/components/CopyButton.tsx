import { useEffect, useRef, useState } from "react";

import { cn } from "../lib/utils";
import { Icon } from "./Icon";

export type CopyButtonProps = {
	text: string;
	className?: string;
};

// Click-to-copy button reused by both code surfaces (markdown fences and the
// clv Code block). Copies `text` via the async clipboard API, then flips to a
// transient "copied" state (check icon) for ~1.6s. clipboard access can be
// absent (insecure context) or rejected (denied permission); either way we
// swallow it so a failed copy never crashes the render.
export function CopyButton({ text, className }: CopyButtonProps) {
	const [copied, setCopied] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

	useEffect(() => () => clearTimeout(timer.current), []);

	const onClick = () => {
		navigator.clipboard
			?.writeText(text)
			.then(() => {
				setCopied(true);
				clearTimeout(timer.current);
				timer.current = setTimeout(() => setCopied(false), 1600);
			})
			.catch(() => {});
	};

	return (
		<button
			type="button"
			className={cn("copybtn", copied && "copied", className)}
			onClick={onClick}
			aria-label={copied ? "Copied" : "Copy code"}
		>
			<Icon name={copied ? "check" : "copy"} size={13} />
		</button>
	);
}
