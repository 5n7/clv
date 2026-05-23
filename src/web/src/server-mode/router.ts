// Minimal serve-mode router: the active file id lives in the `?file=` query.
// `parseFileId` is a pure function (unit-tested); everything else touches the
// DOM (history/location) and notifies subscribers without monkey-patching
// `history.pushState`.

// Pure: extract the `file` id from a query string (with or without leading "?").
export function parseFileId(search: string): string | undefined {
	const id = new URLSearchParams(search).get("file");
	return id ?? undefined;
}

// Pure: the `?file=<id>` query string for an id (with leading "?").
export function fileQuery(id: string): string {
	return "?file=" + encodeURIComponent(id);
}

// Pure: decide how to sync the URL when the file registry changes (a live
// `files-changed` push). If the viewed file (`currentId`) is gone from `files`,
// the URL still carries a dead `?file=` id ("copy link" would share a broken URL)
// even though the view shows the "removed" empty state. Decide without touching
// the DOM so it stays unit-testable:
//   - `clear` — currentId was removed (whether or not other files remain): drop
//               `?file=` entirely. This keeps the "removed" empty state (currentId
//               stays the dead id) AND makes recovery work: clicking ANY sidebar
//               file then navigates from a bare URL (getFileId() undefined) to
//               `?file=<id>`, which differs from the bare URL, so navigate is NOT a
//               no-op and the document opens. (Pointing the URL at the first
//               remaining file instead would make clicking THAT file a no-op —
//               unrecoverable.)
//   - `none`  — currentId is undefined, or still present in files (URL is fine).
export function urlSyncOnFilesChanged(
	currentId: string | undefined,
	files: { id: string }[],
): { kind: "none" } | { kind: "clear" } {
	if (currentId === undefined) return { kind: "none" };
	if (files.some((f) => f.id === currentId)) return { kind: "none" };
	return { kind: "clear" };
}

const subscribers = new Set<() => void>();

function notify(): void {
	for (const cb of subscribers) cb();
}

// Current active file id from the live URL.
export function getFileId(): string | undefined {
	return parseFileId(location.search);
}

// Navigate to a file: push a new history entry and notify subscribers. Skips the
// pushState (and notification) when the id is already active so back/forward
// history stays clean.
export function navigate(id: string): void {
	if (getFileId() === id) return;
	history.pushState(null, "", fileQuery(id));
	notify();
}

// Correct the URL in place (replaceState, no new history entry) without notifying
// subscribers. Used by the initial-load fallback when `?file=<id>` was invalid or
// absent: the resolved id is fetched by the caller already, so a notify here would
// trigger a duplicate fetch via onRouteChange. Skips when the id is already active.
export function replaceFileId(id: string): void {
	if (getFileId() === id) return;
	history.replaceState(null, "", fileQuery(id));
}

// Drop the `?file=` query from the URL in place (replaceState, no new history
// entry) without notifying subscribers. Used by the live `files-changed` handler
// when the viewed file was removed and no files remain, so "copy link" doesn't
// carry a dead id. Skips when there's no active id.
export function clearFileId(): void {
	if (getFileId() === undefined) return;
	history.replaceState(null, "", location.pathname);
}

// Subscribe to route changes from both browser back/forward (popstate) and our
// own `navigate` calls. Returns an unsubscribe.
export function onRouteChange(cb: () => void): () => void {
	subscribers.add(cb);
	const onPop = () => cb();
	window.addEventListener("popstate", onPop);
	return () => {
		subscribers.delete(cb);
		window.removeEventListener("popstate", onPop);
	};
}
