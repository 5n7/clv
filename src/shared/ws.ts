// Server→client WebSocket message contract for serve mode. This is the FIXED
// wire contract both the CLI (sender) and the web SPA (receiver) code against.
//
// Pure types only — NO node/bun imports — so the web side can import it without
// pulling in any CLI code.

import type { Document, FileEntry } from "@shared/types";

export type WsServerMessage =
	// Sent once on connect; lets the client confirm it's talking to a clv server.
	| { type: "hello"; version: string }
	// The set of registered files changed (file added/removed); carries the full
	// current list so the client can replace its file rail wholesale.
	| { type: "files-changed"; files: FileEntry[] }
	// A registered file's content changed; carries the freshly parsed Document.
	| { type: "doc-changed"; fileId: string; doc: Document };
