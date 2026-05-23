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
