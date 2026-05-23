// Ambient declaration for `import doc from "*.md" with { type: "text" }`.
// bun-types declares *.txt / *.html etc. but not *.md; this mirrors the *.txt
// shape so a text-imported Markdown file resolves to its string contents.
declare module "*.md" {
	var contents: string;
	export = contents;
}
