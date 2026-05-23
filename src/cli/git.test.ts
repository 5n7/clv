import { describe, expect, test } from "bun:test";

import { parseGithubRemote } from "./git";

describe("parseGithubRemote", () => {
	test("scp-like ssh with .git", () => {
		expect(parseGithubRemote("git@github.com:5n7/clv.git")).toBe("5n7/clv");
	});

	test("scp-like ssh without .git", () => {
		expect(parseGithubRemote("git@github.com:5n7/clv")).toBe("5n7/clv");
	});

	test("https with .git", () => {
		expect(parseGithubRemote("https://github.com/5n7/clv.git")).toBe("5n7/clv");
	});

	test("https without .git", () => {
		expect(parseGithubRemote("https://github.com/5n7/clv")).toBe("5n7/clv");
	});

	test("https with a trailing slash", () => {
		expect(parseGithubRemote("https://github.com/5n7/clv/")).toBe("5n7/clv");
	});

	test("ssh:// url form without .git", () => {
		expect(parseGithubRemote("ssh://git@github.com/5n7/clv")).toBe("5n7/clv");
	});

	test("ssh:// url form with .git", () => {
		expect(parseGithubRemote("ssh://git@github.com/5n7/clv.git")).toBe("5n7/clv");
	});

	test("surrounding whitespace is tolerated", () => {
		expect(parseGithubRemote("  git@github.com:5n7/clv.git\n")).toBe("5n7/clv");
	});

	test("an uppercase github host is normalized and matches (https)", () => {
		// ownerRepoForHost lowercases the host before comparing, so a casing variant
		// of github.com still resolves rather than falling through to undefined.
		expect(parseGithubRemote("https://GitHub.com/5n7/clv.git")).toBe("5n7/clv");
	});

	test("an uppercase github host is normalized and matches (scp-like ssh)", () => {
		expect(parseGithubRemote("git@GITHUB.com:5n7/clv.git")).toBe("5n7/clv");
	});

	test("a non-github host returns undefined (ssh)", () => {
		expect(parseGithubRemote("git@gitlab.com:5n7/clv.git")).toBeUndefined();
	});

	test("a non-github host returns undefined (https)", () => {
		expect(parseGithubRemote("https://bitbucket.org/5n7/clv.git")).toBeUndefined();
	});

	test("an empty string returns undefined", () => {
		expect(parseGithubRemote("")).toBeUndefined();
	});

	test("a garbage string returns undefined", () => {
		expect(parseGithubRemote("not a url")).toBeUndefined();
	});

	test("a github url with too few path segments returns undefined", () => {
		expect(parseGithubRemote("https://github.com/onlyowner")).toBeUndefined();
	});
});
