import type { Document } from "@shared/types";

// Text-import the single-file SPA built by `build:web`. Bun inlines the file
// contents at build time and HARD-FAILS if dist/template.html is absent — this
// is what makes `build` ordering (web before cli) load-bearing.
import template from "../../dist/template.html" with { type: "text" };
import { injectInto } from "./inject-core";
import { injectServerConfig } from "./inject-server";

// Inject the parsed Document into the built template; pure logic lives in
// `inject-core.ts`. The `as unknown as string` cast is needed because Bun's
// ambient *.html types describe an HTMLBundle, but `type: "text"` inlines the
// file as a string at build time.
export function inject(doc: Document, title: string): string {
	return injectInto(template as unknown as string, doc, title);
}

// Inject the serve-mode config into the built template (analog of `inject`);
// pure logic lives in `inject-server.ts`.
export function injectServer(config: object): string {
	return injectServerConfig(template as unknown as string, config);
}
