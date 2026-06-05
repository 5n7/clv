import type { Document } from "@shared/types";
import "katex/dist/katex.min.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./styles/blocks.css";
import "./styles/diff.css";
import "./styles/fonts.css";
import "./styles/tokens.css";

type ServerConfig = { apiBase: string };

// Read the injected document via a runtime-assembled key so the literal string
// `window.__CLV_DATA__` only appears once in the final HTML (the injected
// <script> the CLI writes), keeping self-containment checks unambiguous. The
// key is built from parts so the minifier cannot constant-fold it back into a
// static `window.__CLV_DATA__` property access.
const DATA_KEY = ["__", "CLV", "_", "DATA", "__"].join("");
const injected = (window as unknown as Record<string, Document | undefined>)[DATA_KEY];

// Serve-mode config. Unlike the data key this needs no split-key trick (serve-
// mode HTML is never the self-contained artifact, so the single-occurrence
// invariant does not apply); the assembled key is only to read it via bracket
// access without a dangling-underscore property reference.
const SERVER_KEY = ["__", "CLV", "_", "SERVER", "__"].join("");
const serverConfig = (window as unknown as Record<string, ServerConfig | undefined>)[SERVER_KEY];

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("clv: #root element not found");
const root = createRoot(rootEl);

function render(data: Document): void {
	root.render(
		<StrictMode>
			<App data={data} />
		</StrictMode>,
	);
}

// Dev-only serve-mode shim. The Vite dev server never injects __CLV_SERVER__, so
// to exercise serve mode under `dev:web` (HMR) point the browser at `?server`.
// Combined with `dev:serve` (Bun API/WS on :7421) + vite's `server.proxy`, the
// SPA talks to the real server over the proxied `/api` and `/ws`. This whole
// block is inside `import.meta.env.DEV`, so Rollup tree-shakes it out of the
// production single-file bundle (no literal `__CLV_SERVER__` leaks in).
if (import.meta.env.DEV && new URLSearchParams(location.search).has("server")) {
	void import("./server-mode/ServerApp").then(({ ServerApp }) =>
		root.render(
			<StrictMode>
				<ServerApp config={{ apiBase: "/api" }} />
			</StrictMode>,
		),
	);
}
// Boot branches, in order:
//   1. dev shim above (DEV + ?server) is the leading `if` of this chain; when it
//      matches, the `else if` branches below are skipped.
//   2. __CLV_DATA__ present → static self-contained page (unchanged).
//   3. __CLV_SERVER__ present → serve mode; ServerApp fetches over the HTTP API.
//      Dynamic import so the serve-mode code is only paid for when active.
//   4. DEV → mock dev document (dynamic import; Vite tree-shakes it in prod).
//   5. otherwise → empty doc.
else if (injected) {
	render(injected);
} else if (serverConfig) {
	import("./server-mode/ServerApp").then(({ ServerApp }) =>
		root.render(
			<StrictMode>
				<ServerApp config={serverConfig} />
			</StrictMode>,
		),
	);
} else if (import.meta.env.DEV) {
	import("./dev-data").then(({ devData }) => render(devData));
} else {
	render({ title: "clv", theme: "auto", nodes: [] });
}
