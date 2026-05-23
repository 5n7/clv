import type { WsServerMessage } from "@shared/ws";

// Serve-mode WebSocket client. Connects to `/ws` on the same host, parses
// server→client frames, and auto-reconnects with capped backoff. The optional
// `onStatus` drives the reconnect banner: `connecting` on each attempt, `open`
// once connected, and `closed` when the socket drops (before the reconnect
// timer arms).

const MIN_BACKOFF = 500; // 0.5s
const MAX_BACKOFF = 5000; // 5s

export type WsStatus = "connecting" | "open" | "closed";
export type WsClient = { close(): void };

// Close (remove-from-session) files by id. Fire-and-forget: the server's
// `files-changed` WS broadcast updates the sidebar via the existing subscription,
// so we deliberately do NOT read the response or optimistically mutate local
// state (matching how `add` already works). A failed fetch is logged, never
// thrown, so a transient error can't crash the SPA.
export async function closeFiles(apiBase: string, ids: string[]): Promise<void> {
	try {
		await fetch(`${apiBase}/files/close`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ ids }),
		});
	} catch (err) {
		console.error("clv: failed to close files", err);
	}
}

export function createWsClient(onMessage: (m: WsServerMessage) => void, onStatus?: (s: WsStatus) => void): WsClient {
	let ws: WebSocket | null = null;
	let backoff = MIN_BACKOFF;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let closed = false;

	const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

	const scheduleReconnect = () => {
		if (closed || reconnectTimer) return;
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			connect();
		}, backoff);
		backoff = Math.min(backoff * 2, MAX_BACKOFF);
	};

	const connect = () => {
		if (closed) return;
		onStatus?.("connecting");
		try {
			ws = new WebSocket(url);
		} catch {
			onStatus?.("closed");
			scheduleReconnect();
			return;
		}

		ws.onopen = () => {
			backoff = MIN_BACKOFF; // reset on a successful connection
			onStatus?.("open");
		};
		ws.onmessage = (event) => {
			let msg: WsServerMessage;
			try {
				msg = JSON.parse(String(event.data)) as WsServerMessage;
			} catch {
				return; // tolerate malformed frames
			}
			onMessage(msg);
		};
		ws.onclose = () => {
			ws = null;
			onStatus?.("closed");
			scheduleReconnect();
		};
		ws.onerror = () => {
			// Let onclose drive reconnection; closing here avoids a dangling socket.
			ws?.close();
		};
	};

	connect();

	return {
		close() {
			closed = true;
			if (reconnectTimer) {
				clearTimeout(reconnectTimer);
				reconnectTimer = null;
			}
			ws?.close();
			ws = null;
		},
	};
}
