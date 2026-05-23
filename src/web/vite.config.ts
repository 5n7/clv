import react from "@vitejs/plugin-react";
import { rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../../dist");

// vite-plugin-singlefile emits `index.html`; the CLI text-imports `template.html`.
// Rename after the bundle is fully written.
function renameToTemplate(): Plugin {
	return {
		name: "clv-rename-to-template",
		async closeBundle() {
			try {
				await rename(resolve(outDir, "index.html"), resolve(outDir, "template.html"));
			} catch {
				// dev server (no bundle written) — nothing to rename.
			}
		},
	};
}

export default defineConfig({
	root: here,
	plugins: [react(), viteSingleFile(), renameToTemplate()],
	resolve: {
		alias: {
			"@shared": resolve(here, "../shared"),
		},
	},
	// Dev-only: proxy the serve-mode API + WebSocket to the Bun server started by
	// `bun run dev:serve` (port 7421). Has no effect on `vite build` (the prod
	// single-file artifact never sees this), so it's safe alongside the bundle.
	server: {
		proxy: {
			"/api": { target: "http://localhost:7421", changeOrigin: true },
			"/ws": { target: "http://localhost:7421", ws: true, changeOrigin: true },
		},
	},
	build: {
		outDir,
		emptyOutDir: false,
		assetsInlineLimit: 100000000,
		rollupOptions: {
			output: {
				inlineDynamicImports: true,
				manualChunks: undefined,
			},
		},
	},
});
