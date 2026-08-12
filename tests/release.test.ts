// @vitest-environment node

import { execFileSync, spawnSync } from "node:child_process";
import {
	chmodSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";

interface PackageFixture {
	version: string;
}

interface LockFixture {
	version: string;
	packages: {
		"": {
			version: string;
		};
	};
}

interface ManifestFixture {
	id: string;
	name: string;
	version: string;
	minAppVersion: string;
	description: string;
	author: string;
	isDesktopOnly: boolean;
}

type VersionsFixture = Record<string, string>;

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const versionScript = resolve(repositoryRoot, "scripts/version.mjs");
const verifyScript = resolve(repositoryRoot, "scripts/verify-release.mjs");
const releaseWorkflow = readFileSync(
	resolve(repositoryRoot, ".github/workflows/release.yml"),
	"utf8",
);
const fixtures: string[] = [];

function writeJson(path: string, value: unknown): void {
	writeFileSync(path, `${JSON.stringify(value, null, "\t")}\n`);
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

function createFixture(): string {
	const root = mkdtempSync(resolve(tmpdir(), "tabsdown-release-"));
	fixtures.push(root);
	writeJson(resolve(root, "package.json"), {
		name: "obsidian-tabsdown",
		version: "0.1.0",
	});
	writeJson(resolve(root, "package-lock.json"), {
		name: "obsidian-tabsdown",
		version: "0.1.0",
		lockfileVersion: 3,
		requires: true,
		packages: {
			"": {
				name: "obsidian-tabsdown",
				version: "0.1.0",
			},
		},
	});
	writeJson(resolve(root, "manifest.json"), {
		id: "tabsdown",
		name: "Tabsdown",
		version: "0.1.0",
		minAppVersion: "1.0.0",
		description: "Tabbed blocks.",
		author: "grafanaKibana",
		isDesktopOnly: false,
	});
	writeJson(resolve(root, "versions.json"), { "0.1.0": "1.0.0" });
	writeFileSync(resolve(root, "main.js"), "module.exports = {};\n");
	writeFileSync(resolve(root, "styles.css"), ".tabsdown {}\n");
	return root;
}

function runVerify(root: string, tag?: string): ReturnType<typeof spawnSync> {
	return spawnSync(process.execPath, [verifyScript, ...(tag ? [tag] : [])], {
		cwd: root,
		encoding: "utf8",
	});
}

afterEach(() => {
	for (const fixture of fixtures.splice(0)) {
		rmSync(fixture, { recursive: true, force: true });
	}
});

test("demo enables only plugins with tracked runtime bundles", () => {
	const enabled = readJson<string[]>(
		resolve(repositoryRoot, "demo/.obsidian/community-plugins.json"),
	);
	const tracked = execFileSync(
		"git",
		["ls-files", "demo/.obsidian/plugins/*/main.js"],
		{ cwd: repositoryRoot, encoding: "utf8" },
	)
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((path) => basename(dirname(path)));

	expect(enabled.sort()).toEqual(tracked.sort());
});

test("keeps the full-resolution README showcase linked and reasonably sized", () => {
	const readme = readFileSync(resolve(repositoryRoot, "README.md"), "utf8");
	expect(readme).toContain("![](docs/assets/tabsdown-showcase.gif)");
	expect(statSync(resolve(repositoryRoot, "docs/assets/tabsdown-showcase.gif")).size)
		.toBeLessThanOrEqual(10_000_000);
});

test("releases the current main head without a commit input", () => {
	expect(releaseWorkflow).not.toContain("inputs.commit");
	expect(releaseWorkflow).not.toContain("RELEASE_COMMIT");
	const install = releaseWorkflow.indexOf("- run: npm ci");
	const tag = releaseWorkflow.indexOf('ref="refs/tags/$version"');
	expect(install).toBeGreaterThan(-1);
	expect(tag).toBeGreaterThan(install);
});

test("uploads release assets to a draft before publishing", () => {
	const create = releaseWorkflow.indexOf('gh release create "$version"');
	const upload = releaseWorkflow.indexOf('gh release upload "$version" main.js manifest.json styles.css --clobber');
	const publish = releaseWorkflow.indexOf('gh release edit "$version" --draft=false --latest');
	expect(create).toBeGreaterThan(-1);
	expect(releaseWorkflow.slice(create, upload)).toContain("--draft");
	expect(releaseWorkflow.slice(create, upload)).not.toMatch(/gh release create[^\n]*(main\.js|manifest\.json|styles\.css)/);
	expect(upload).toBeGreaterThan(create);
	expect(publish).toBeGreaterThan(upload);
	expect(releaseWorkflow.indexOf('release_state" == "false"')).toBeLessThan(upload);
});

test("updates package, lockfile, manifest, and versions together", () => {
	const root = createFixture();

	execFileSync(process.execPath, [versionScript, "0.2.0"], { cwd: root });

	const packageJson = readJson<PackageFixture>(resolve(root, "package.json"));
	const lock = readJson<LockFixture>(resolve(root, "package-lock.json"));
	const manifest = readJson<ManifestFixture>(resolve(root, "manifest.json"));
	const versions = readJson<VersionsFixture>(resolve(root, "versions.json"));
	expect(packageJson.version).toBe("0.2.0");
	expect(lock.version).toBe("0.2.0");
	expect(lock.packages[""].version).toBe("0.2.0");
	expect(manifest.version).toBe("0.2.0");
	expect(versions["0.2.0"]).toBe("1.0.0");
	expect(runVerify(root).status).toBe(0);
});

test.each(["v0.2.0", "01.2.3", "1.02.3", "1.2.03"])(
	"rejects invalid version %s without modifying release metadata",
	(version) => {
	const root = createFixture();
	const before = ["package.json", "package-lock.json", "manifest.json", "versions.json"]
		.map((name) => readFileSync(resolve(root, name), "utf8"));

	const result = spawnSync(process.execPath, [versionScript, version], {
		cwd: root,
		encoding: "utf8",
	});

	expect(result.status).not.toBe(0);
	expect(
		["package.json", "package-lock.json", "manifest.json", "versions.json"]
			.map((name) => readFileSync(resolve(root, name), "utf8")),
	).toEqual(before);
	},
);

test.runIf(process.platform !== "win32")(
	"rolls back all metadata when npm mutates files and fails",
	() => {
		const root = createFixture();
		const before = ["package.json", "package-lock.json", "manifest.json", "versions.json"]
			.map((name) => readFileSync(resolve(root, name)));
		const bin = resolve(root, "bin");
		mkdirSync(bin);
		const fakeNpm = resolve(bin, "npm");
		writeFileSync(
			fakeNpm,
			[
				"#!/usr/bin/env node",
				'const fs = require("node:fs");',
				'for (const name of ["package.json", "package-lock.json"]) {',
				"  const value = JSON.parse(fs.readFileSync(name, \"utf8\"));",
				'  value.version = "9.9.9";',
				'  if (value.packages?.[""]) value.packages[""].version = "9.9.9";',
				"  fs.writeFileSync(name, JSON.stringify(value));",
				"}",
				"process.exit(1);",
			].join("\n"),
		);
		chmodSync(fakeNpm, 0o755);

		const result = spawnSync(process.execPath, [versionScript, "0.2.0"], {
			cwd: root,
			encoding: "utf8",
			env: {
				...process.env,
				PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
			},
		});

		expect(result.status).not.toBe(0);
		expect(
			["package.json", "package-lock.json", "manifest.json", "versions.json"]
				.map((name) => readFileSync(resolve(root, name))),
		).toEqual(before);
	},
);

test.each([
	"package.json",
	"package-lock.json",
	"manifest.json",
	"versions.json",
])("rejects a mismatched %s", (name) => {
	const root = createFixture();
	const path = resolve(root, name);

	if (name === "package.json") {
		const value = readJson<PackageFixture>(path);
		value.version = "0.2.0";
		writeJson(path, value);
	} else if (name === "package-lock.json") {
		const value = readJson<LockFixture>(path);
		value.packages[""].version = "0.2.0";
		writeJson(path, value);
	} else if (name === "manifest.json") {
		const value = readJson<ManifestFixture>(path);
		value.version = "0.2.0";
		writeJson(path, value);
	} else {
		const value = readJson<VersionsFixture>(path);
		value["0.1.0"] = "2.0.0";
		writeJson(path, value);
	}

	expect(runVerify(root).status).not.toBe(0);
});

test.each(["main.js", "manifest.json", "styles.css"])(
	"rejects missing release asset %s",
	(asset) => {
	const root = createFixture();
	rmSync(resolve(root, asset));
	expect(runVerify(root).status).not.toBe(0);
	},
);

test.each(["main.js", "styles.css"])(
	"rejects empty release asset %s",
	(asset) => {
		const root = createFixture();
		writeFileSync(resolve(root, asset), "");
		expect(runVerify(root).status).not.toBe(0);
	},
);

test("rejects aligned metadata with leading-zero SemVer", () => {
	const root = createFixture();
	const packageJson = readJson<PackageFixture>(resolve(root, "package.json"));
	const lock = readJson<LockFixture>(resolve(root, "package-lock.json"));
	const manifest = readJson<ManifestFixture>(resolve(root, "manifest.json"));
	const versions = readJson<VersionsFixture>(resolve(root, "versions.json"));
	packageJson.version = "01.2.3";
	lock.version = "01.2.3";
	lock.packages[""].version = "01.2.3";
	manifest.version = "01.2.3";
	versions["01.2.3"] = manifest.minAppVersion;
	writeJson(resolve(root, "package.json"), packageJson);
	writeJson(resolve(root, "package-lock.json"), lock);
	writeJson(resolve(root, "manifest.json"), manifest);
	writeJson(resolve(root, "versions.json"), versions);
	expect(runVerify(root).status).not.toBe(0);
});

test("rejects missing manifest fields", () => {
	const root = createFixture();
	const manifest = readJson<Partial<ManifestFixture>>(
		resolve(root, "manifest.json"),
	);
	delete manifest.author;
	writeJson(resolve(root, "manifest.json"), manifest);
	expect(runVerify(root).status).not.toBe(0);
});

test.each(["obsidian-tabs", "tabs-plugin", "Tabs"])(
	"rejects invalid plugin id %s",
	(id) => {
		const root = createFixture();
		const manifest = readJson<ManifestFixture>(resolve(root, "manifest.json"));
		manifest.id = id;
		writeJson(resolve(root, "manifest.json"), manifest);
		expect(runVerify(root).status).not.toBe(0);
	},
);

test.each(["v0.1.0", "0.2.0"])("rejects mismatched tag %s", (tag) => {
	const root = createFixture();
	expect(runVerify(root, tag).status).not.toBe(0);
});
