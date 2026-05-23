import type { FileEntry } from "@shared/types";
import { sep } from "node:path";

// Pick the file id to open after registering paths. A directory arg expands to
// files inside it, so match an entry whose path equals a resolved arg or lives
// under one; fall back to the first entry when nothing matches.
export function pickOpenId(entries: FileEntry[], resolvedArgs: string[]): string | undefined {
	const match = entries.find((e) => resolvedArgs.some((arg) => e.path === arg || e.path.startsWith(arg + sep)));
	return (match ?? entries[0])?.id;
}
