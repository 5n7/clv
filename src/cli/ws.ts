import type { Document, FileEntry } from "@shared/types";
import type { WsServerMessage } from "@shared/ws";

// Pure builders + serializer for the server→client WS contract (@shared/ws).
// No I/O — serve.ts wires these to the live socket set.

export function buildDocChanged(fileId: string, doc: Document): WsServerMessage {
	return { type: "doc-changed", fileId, doc };
}

export function buildFilesChanged(files: FileEntry[]): WsServerMessage {
	return { type: "files-changed", files };
}

export function buildHello(version: string): WsServerMessage {
	return { type: "hello", version };
}

export function serialize(msg: WsServerMessage): string {
	return JSON.stringify(msg);
}
