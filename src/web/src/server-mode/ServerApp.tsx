import type { Document, FileEntry } from "@shared/types";
import type { WsServerMessage } from "@shared/ws";
import { useEffect, useMemo, useRef, useState } from "react";

import { App } from "../App";
import { AssetBaseContext } from "../lib/assetUrl";
import { clearFileId, getFileId, navigate, onRouteChange, replaceFileId, urlSyncOnFilesChanged } from "./router";
import { Sidebar } from "./Sidebar";
import { createWsClient, type WsStatus } from "./wsClient";

// Serve-mode root. Owns the file registry, the active file id (URL-driven via the
// router), and the active Document. Live updates arrive over the
// WebSocket: `doc-changed` swaps `doc` in place (App re-renders, never remounts,
// so theme / scroll / rail state persist), `files-changed` replaces the rail's
// file list wholesale.
export function ServerApp({ config: { apiBase } }: { config: { apiBase: string } }) {
	const [files, setFiles] = useState<FileEntry[]>([]);
	const [currentId, setCurrentId] = useState<string | undefined>(() => getFileId());
	const [doc, setDoc] = useState<Document | undefined>(undefined);
	const [error, setError] = useState<string | null>(null);
	const [ready, setReady] = useState(false);
	const [wsStatus, setWsStatus] = useState<WsStatus>("connecting");
	// Suppress the reconnect banner until the live connection has succeeded once,
	// so normal startup doesn't flash a "reconnecting" pill before the first open.
	const [everConnected, setEverConnected] = useState(false);

	// Latest currentId visible to the WS callback (which is registered once) so it
	// can compare an incoming doc-changed.fileId without re-subscribing per change.
	const currentIdRef = useRef<string | undefined>(currentId);
	currentIdRef.current = currentId;

	// Initial load: fetch the file registry, resolve the active id (URL → first
	// file), and fetch its document.
	useEffect(() => {
		let cancelled = false;
		const load = async () => {
			setError(null);
			try {
				const list = (await fetchJson(`${apiBase}/files`)) as FileEntry[];
				if (cancelled) return;
				setFiles(list);

				const urlId = getFileId();
				const id = urlId && list.some((f) => f.id === urlId) ? urlId : list[0]?.id;
				setCurrentId(id);
				// A fallback happened (the URL's id was bogus or absent): correct the URL
				// in place so "copy link" shares the file actually shown. replaceState (not
				// push) so it's a correction, not a history entry; it does not re-notify.
				if (id && id !== urlId) replaceFileId(id);
				if (id) {
					const fetched = (await fetchJson(`${apiBase}/files/${encodeURIComponent(id)}`)) as Document;
					if (!cancelled) setDoc(fetched);
				}
			} catch (err) {
				if (!cancelled) setError(err instanceof Error ? err.message : String(err));
			} finally {
				if (!cancelled) setReady(true);
			}
		};
		void load();
		return () => {
			cancelled = true;
		};
	}, [apiBase]);

	// React to URL changes (back/forward + Sidebar selection routed through
	// `navigate`): recompute the active id and fetch that document. The previous
	// doc stays rendered until the new one arrives so theme/rail/scroll persist.
	useEffect(() => {
		return onRouteChange(() => {
			const id = getFileId();
			setCurrentId(id);
			// Clear any prior error as soon as a navigation starts so a transient
			// failure can't pin a stale message across file selections (this also
			// covers the `!id` early return below).
			setError(null);
			if (!id) return;
			void (async () => {
				try {
					const fetched = (await fetchJson(`${apiBase}/files/${encodeURIComponent(id)}`)) as Document;
					if (getFileId() === id) setDoc(fetched); // ignore stale responses; success leaves error null
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err));
				}
			})();
		});
	}, [apiBase]);

	// WebSocket live updates. Registered once; reads currentId via the ref.
	useEffect(() => {
		const client = createWsClient(
			(msg: WsServerMessage) => {
				if (msg.type === "files-changed") {
					setFiles(msg.files);
					// The viewed file may have just been unlinked. We do NOT navigate (the
					// "removed" empty state stays until the user picks a file), but the URL
					// still carries the now-dead `?file=` id, so "copy link" would share a
					// broken URL. Drop `?file=` in place (no notify → no jump, no refetch).
					// Clearing also enables recovery: the bare URL makes a subsequent sidebar
					// pick a real navigate (it differs from the bare URL, not a no-op).
					const sync = urlSyncOnFilesChanged(currentIdRef.current, msg.files);
					if (sync.kind === "clear") clearFileId();
				} else if (msg.type === "doc-changed") {
					// Idempotent / last-write-wins per fileId; use the pushed doc directly
					// (no refetch). Ignore updates for files we're not viewing.
					if (msg.fileId === currentIdRef.current) setDoc(msg.doc);
				}
				// `hello` is ignored.
			},
			(status) => {
				setWsStatus(status);
				if (status === "open") setEverConnected(true);
			},
		);
		return () => client.close();
	}, []);

	// Memoized so consumers (the Markdown renderer) only re-render when the active
	// file id actually changes, not on every ServerApp render.
	const assetCtx = useMemo(() => (currentId ? { fileId: currentId } : null), [currentId]);

	// Full-screen error ONLY before a file list ever arrived (initial load failed
	// outright). Once `files` is populated the error is non-blocking: it's surfaced
	// inline (below) so the sidebar stays usable and the user can navigate away to
	// recover.
	if (error && files.length === 0) {
		return <Notice text={`clv: failed to load document — ${error}`} />;
	}
	// Whole-session empty state: no files at all.
	if (ready && files.length === 0) {
		return <Notice text="clv: no files registered." />;
	}

	// The current file was removed from the session (e.g. unlinked / deleted) but
	// other files remain. Keep the shell — and crucially the sidebar — so the user
	// can pick another file, and replace the stale stream with a clear empty state.
	const currentUnlinked = ready && Boolean(currentId) && !files.some((f) => f.id === currentId);

	const banner =
		!everConnected || wsStatus === "open" ? null : (
			<div className="clv-reconnect" role="status">
				● reconnecting…
			</div>
		);

	const sidebar = <Sidebar files={files} currentId={currentId} onSelect={(id) => navigate(id)} />;

	// Stand-in so `App` has a Document to render the shell/sidebar with when its
	// stream is replaced by `emptyMain`. `doc` is the last-known document; the
	// fallback covers the never-loaded case.
	const standIn: Document = doc ?? { title: "clv", theme: "auto", nodes: [] };

	// A non-blocking failure with a file list present: keep the shell + sidebar and
	// surface the error in the main area (reusing the `emptyMain` slot), so picking
	// another file re-runs the route-change fetch, clears the error, and recovers.
	// Error takes priority over the unlinked empty state.
	if (error) {
		return (
			<>
				{banner}
				<App data={standIn} serveMode sidebar={sidebar} emptyMain={<ErrorEmptyState message={error} />} />
			</>
		);
	}

	if (currentUnlinked) {
		return (
			<>
				{banner}
				<App data={standIn} serveMode sidebar={sidebar} emptyMain={<UnlinkedEmptyState />} />
			</>
		);
	}

	if (!doc || !currentId) {
		return <Notice text="clv: loading…" />;
	}

	return (
		<AssetBaseContext.Provider value={assetCtx}>
			{banner}
			<App data={doc} serveMode sidebar={sidebar} />
		</AssetBaseContext.Provider>
	);
}

function ErrorEmptyState({ message }: { message: string }) {
	return (
		<div className="clv-empty">
			<div className="clv-empty-title">Failed to load this file.</div>
			<div className="clv-empty-hint">{message}</div>
			<div className="clv-empty-hint">Pick another file from the sidebar to continue.</div>
		</div>
	);
}

function Notice({ text }: { text: string }) {
	return <div style={{ padding: 24, fontFamily: "var(--mono)" }}>{text}</div>;
}

function UnlinkedEmptyState() {
	return (
		<div className="clv-empty">
			<div className="clv-empty-title">This file was removed.</div>
			<div className="clv-empty-hint">Pick another file from the sidebar to continue.</div>
		</div>
	);
}

async function fetchJson(url: string): Promise<unknown> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
	return res.json();
}
