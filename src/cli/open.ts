// Open a file path in the OS default browser. Tries `open` (macOS) /
// `xdg-open` (Linux) / `start` (Windows) in turn. On total failure, prints the
// path to stdout and resolves (caller exits 0) per SPEC §10.
export async function openInBrowser(path: string): Promise<void> {
	let candidates: string[][];
	switch (process.platform) {
		case "darwin":
			candidates = [["open", path]];
			break;
		case "win32":
			candidates = [["cmd", "/c", "start", "", path]];
			break;
		default:
			candidates = [
				["xdg-open", path],
				["open", path],
			];
	}

	for (const cmd of candidates) {
		try {
			const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
			const code = await proc.exited;
			if (code === 0) return;
		} catch {
			// try the next candidate
		}
	}

	console.log(path);
}
