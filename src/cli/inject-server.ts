import { insertAfterRootAnchor, jsonScriptLiteral } from "./inject-core";

// Serve-mode analog of `injectInto`: injects `window.__CLV_SERVER__` using the
// same anchor/escaping rules. Pure, so it is unit-testable with a synthetic
// template; `inject.ts` supplies the real `dist/template.html`.
export function injectServerConfig(template: string, config: object): string {
	const tag = `<script>window.__CLV_SERVER__=${jsonScriptLiteral(config)}</script>`;
	return insertAfterRootAnchor(template, tag);
}
