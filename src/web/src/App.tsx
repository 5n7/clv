import { blockDataSchemas, type KnownBlockType } from "@shared/schema";
import type { DocNode, Document } from "@shared/types";
import { VERSION } from "@shared/version";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { BlockDispatcher, FallbackBlock } from "./blocks";
import { Icon } from "./components/Icon";
import { CodeIndexProvider } from "./lib/codeIndex";
import { Markdown } from "./lib/markdown";

const BLOCK_TYPES = Object.keys(blockDataSchemas) as KnownBlockType[];

type Theme = "light" | "dark";

// `sidebar`, when provided (serve mode), replaces the static-export rail panels
// (Document stats / Block types) with a live file navigator; the Outline below
// always reflects the current document. When omitted (static export) the rail is
// byte-for-byte the original layout.
// `emptyMain`, when provided (serve mode), replaces the document stream in the
// main pane with a stand-in (e.g. the unlinked-file empty state) while keeping
// the rail/sidebar/topbar intact so the user can still navigate.
// `serveMode` switches network-related wording (topbar pill + footer) to language
// accurate for the live HTTP/WS server. Omitted (static export) keeps the
// original "self-contained / no network calls" wording byte-for-byte.
export function App({
	data,
	sidebar,
	emptyMain,
	serveMode,
}: {
	data: Document;
	sidebar?: ReactNode;
	emptyMain?: ReactNode;
	serveMode?: boolean;
}) {
	// When the document pins a theme, honor it and skip matchMedia entirely.
	const pinned: Theme | null = data.theme === "light" || data.theme === "dark" ? data.theme : null;

	const [theme, setTheme] = useState<Theme>(() => {
		if (pinned) return pinned;
		if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) return "dark";
		return "light";
	});

	// When the document pins light/dark, the CLI flag wins — no manual override.
	const effectiveTheme = pinned ?? theme;

	const [railOpen, setRailOpen] = useState(true);

	useEffect(() => {
		document.documentElement.classList.toggle("theme-dark", effectiveTheme === "dark");
	}, [effectiveTheme]);

	// Only follow system preference when the document leaves theme on "auto".
	useEffect(() => {
		if (pinned) return;
		const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
		if (!mq) return;
		const onChange = (e: MediaQueryListEvent) => setTheme(e.matches ? "dark" : "light");
		mq.addEventListener("change", onChange);
		return () => mq.removeEventListener("change", onChange);
	}, [pinned]);

	// Table of contents from titled block nodes. Only blocks with an `id` get a
	// scroll anchor (code blocks auto-id; others need an explicit id), so skip
	// entries without one rather than emit dead `href={undefined}` links.
	const toc = useMemo(
		() =>
			data.nodes.flatMap((n) => {
				if (n.kind !== "block") return [];
				const { id, title } = n.block.data;
				if (!title || id == null) return [];
				return [{ id, title, type: n.block.type }];
			}),
		[data],
	);

	const [activeId, setActiveId] = useState<string | undefined>(toc[0]?.id);
	useEffect(() => {
		const els = toc.map((t) => document.getElementById(t.id)).filter((el): el is HTMLElement => Boolean(el));
		if (!els.length) return;
		const io = new IntersectionObserver(
			(entries) => {
				const vis = entries
					.filter((e) => e.isIntersecting)
					.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
				if (vis[0]) setActiveId(vis[0].target.id);
			},
			{ rootMargin: "-80px 0px -65% 0px", threshold: [0, 1] },
		);
		els.forEach((el) => io.observe(el));
		return () => io.disconnect();
	}, [toc]);

	// Guard against a document missing `source` (e.g. stdin input). The CLI also
	// defaults this, but the SPA must not render the literal "undefined".
	const source = data.source || "stdin";

	const stats = useMemo(() => {
		const blocks = data.nodes.filter((n): n is Extract<DocNode, { kind: "block" }> => n.kind === "block");
		const fallbacks = data.nodes.filter((n) => n.kind === "fallback").length;
		const blockTypes = new Set(blocks.map((b) => b.block.type)).size;
		let findings = 0;
		for (const b of blocks) {
			if (b.block.type === "findings") {
				findings += (b.block.data.items ?? []).length;
			}
		}
		return { blocks: blocks.length, blockTypes, fallbacks, findings };
	}, [data]);

	return (
		<CodeIndexProvider doc={data}>
			<div className={"shell" + (railOpen ? "" : " rail-collapsed")}>
				<aside className="rail">
					<div className="brand">
						<span className="mark">{"{}"}</span>
						<span>clv</span>
					</div>

					{sidebar ? (
						sidebar
					) : (
						<>
							<div style={{ marginTop: 18 }} className="meta">
								<div>
									<b>{source}</b>
								</div>
								<div>
									generated&nbsp;<span style={{ color: "var(--ink-2)" }}>{data.generated}</span>
								</div>
							</div>

							<h6>Document</h6>
							<div className="stats">
								<div className="stat">
									<div className="n">{stats.blocks}</div>
									<div className="l">blocks</div>
								</div>
								<div className="stat">
									<div className="n">{stats.findings}</div>
									<div className="l">findings</div>
								</div>
							</div>
						</>
					)}

					<h6>Outline</h6>
					<nav className="toc">
						{toc.map((t, i) => (
							<a
								key={t.id}
								href={"#" + t.id}
								className={activeId === t.id ? "active" : ""}
								onClick={() => setActiveId(t.id)}
							>
								<span className="ix">{String(i + 1).padStart(2, "0")}</span>
								<span
									style={{
										flex: 1,
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
									}}
								>
									{t.title}
								</span>
								<span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-4)" }}>{t.type}</span>
							</a>
						))}
					</nav>

					{!sidebar && (
						<>
							<h6>Block types in spec</h6>
							<div className="meta" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 12px" }}>
								{BLOCK_TYPES.map((t) => (
									<span key={t}>
										clv:<b>{t}</b>
									</span>
								))}
							</div>
						</>
					)}
				</aside>

				<main className="main">
					<header className="topbar">
						<button
							className="tbtn icon"
							onClick={() => setRailOpen((o) => !o)}
							aria-label={railOpen ? "collapse sidebar" : "expand sidebar"}
							title={railOpen ? "collapse sidebar" : "expand sidebar"}
						>
							<Icon name="panelLeft" size={15} />
						</button>
						<span className="crumb">
							<Icon name="folder" size={13} />
							~/clv&nbsp;<span style={{ color: "var(--ink-4)" }}>›</span>&nbsp;<b>{source}</b>
						</span>
						<span className="pill">
							<span className="dot" /> rendered
						</span>
						<span className="spacer" />
						<span
							className="pill"
							title={serveMode ? "served live by clv; auto-reloads on change" : "rendered from inline JSON"}
						>
							<span className="dot" />
							{serveMode ? "live" : "self-contained"}
						</span>
						<button className="tbtn" onClick={() => navigator.clipboard?.writeText(window.location.href)}>
							<Icon name="copy" size={13} /> copy link
						</button>
						{!pinned && (
							<button
								className="tbtn icon"
								onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
								aria-label="toggle theme"
							>
								<Icon name={effectiveTheme === "dark" ? "sun" : "moon"} size={14} />
							</button>
						)}
					</header>

					{emptyMain ? (
						<div className="stream">{emptyMain}</div>
					) : (
						<div className="stream">
							<h1 className="doc-title">{data.title}</h1>
							<div className="doc-sub">
								<code>$ bunx clv {source}</code>
								<span className="sep" />
								<span>{data.subtitle}</span>
							</div>

							{data.nodes.map((n, idx) => {
								// Stable, content-derived key so a changed/inserted/removed node
								// only remounts itself (preserving scroll). Every DocNode now
								// carries a node-level `id`; `n-${idx}` is a defensive safety net.
								const key = n.id ?? `n-${idx}`;
								if (n.kind === "markdown") {
									return <Markdown key={key}>{n.markdown}</Markdown>;
								}
								if (n.kind === "block") {
									return <BlockDispatcher key={key} block={n.block} />;
								}
								return <FallbackBlock key={key} blockType={n.blockType} raw={n.raw} error={n.error} />;
							})}

							<footer
								style={{
									marginTop: 56,
									padding: "20px 0",
									borderTop: "1px solid var(--line)",
									fontFamily: "var(--mono)",
									fontSize: 12,
									color: "var(--ink-3)",
									display: "flex",
									gap: 14,
									flexWrap: "wrap",
									alignItems: "center",
								}}
							>
								<span>
									<b style={{ color: "var(--ink)" }}>clv</b> {VERSION}
								</span>
								<span>·</span>
								<span>
									{serveMode ? "served live · auto-reloads on change" : "rendered locally · no network calls"}
								</span>
								<span>·</span>
								<span>
									{stats.blockTypes} block type{stats.blockTypes === 1 ? "" : "s"} · {stats.fallbacks} fallback
									{stats.fallbacks === 1 ? "" : "s"}
								</span>
							</footer>
						</div>
					)}
				</main>
			</div>
		</CodeIndexProvider>
	);
}
