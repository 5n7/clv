import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

// Observe the `theme-dark` class App toggles on <html>. Blocks that embed a real
// library with its own theming (mermaid, git-diff-view) subscribe to this so they
// can re-render on theme change without threading props through the dispatcher.
export function useTheme(): Theme {
	const [theme, setTheme] = useState<Theme>(read);
	useEffect(() => {
		const obs = new MutationObserver(() => setTheme(read()));
		obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
		setTheme(read());
		return () => obs.disconnect();
	}, []);
	return theme;
}

function read(): Theme {
	return document.documentElement.classList.contains("theme-dark") ? "dark" : "light";
}
