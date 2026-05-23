// Auto-derive the sidebar group from the local git repo: the GitHub `owner/repo`
// of the origin remote (e.g. "5n7/clv"). Used when `-g`/`--group` is omitted so
// running clv inside a repo groups its files under that repo's name. The only
// impure part (running git) is isolated in `resolveAutoGroup`; `parseGithubRemote`
// is pure and unit-tested.

// Build `owner/repo` from a host + path, but only for github.com. Strips a
// leading slash, a trailing slash, and a trailing `.git`, then requires exactly
// `owner/repo` (two non-empty segments).
function ownerRepoForHost(host: string, path: string): string | undefined {
	if (host.toLowerCase() !== "github.com") return undefined;
	const cleaned = path
		.replace(/^\/+/, "")
		.replace(/\/+$/, "")
		.replace(/\.git$/, "");
	const segs = cleaned.split("/");
	if (segs.length !== 2 || !segs[0] || !segs[1]) return undefined;
	return `${segs[0]}/${segs[1]}`;
}

// Parse `owner/repo` out of a GitHub remote URL. Handles the common forms:
//   - git@github.com:owner/repo.git          (scp-like ssh)
//   - https://github.com/owner/repo.git      (https)
//   - ssh://git@github.com/owner/repo        (ssh url, no .git)
// with or without a trailing `.git` / slash. Returns `owner/repo` ONLY for
// github.com hosts; any other host (or an unparseable URL) yields undefined so
// the caller falls back to "default".
export function parseGithubRemote(url: string): string | undefined {
	const trimmed = url.trim();
	if (!trimmed) return undefined;

	// scp-like syntax has no scheme: `git@github.com:owner/repo.git`. Match the
	// `host:path` shape directly (a colon NOT followed by `//` distinguishes it
	// from a `scheme://` URL).
	const scpMatch = trimmed.match(/^(?:[^@/]+@)?([^/:]+):(.+)$/);
	if (scpMatch && !trimmed.includes("://")) {
		return ownerRepoForHost(scpMatch[1]!, scpMatch[2]!);
	}

	// Scheme URLs (https://, ssh://, git://). `URL` extracts the host and path.
	try {
		const parsed = new URL(trimmed);
		return ownerRepoForHost(parsed.hostname, parsed.pathname);
	} catch {
		return undefined;
	}
}

// Resolve the auto group for `cwd`: the GitHub `owner/repo` of its origin remote,
// or undefined when `cwd` is not a git repo, has no origin, git is missing, or
// the remote isn't a github.com URL. This is the only impure function here.
export function resolveAutoGroup(cwd: string): string | undefined {
	try {
		const proc = Bun.spawnSync(["git", "-C", cwd, "config", "--get", "remote.origin.url"], {
			stdout: "pipe",
			stderr: "ignore",
		});
		if (!proc.success) return undefined;
		const url = proc.stdout.toString().trim();
		return url ? parseGithubRemote(url) : undefined;
	} catch {
		// git missing / spawn failure → no auto group.
		return undefined;
	}
}
