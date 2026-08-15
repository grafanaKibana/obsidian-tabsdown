import { describe, expect, test } from "vitest";

import { configEdit, parseConfigToken, serializeConfig } from "../src/config";

test.each(["constructor=value", "__proto__=value"])(
	"rejects inherited-looking key %s",
	(token) => expect(parseConfigToken(token)).toEqual({ kind: "invalid" }),
);

describe("serializeConfig", () => {
	test("uses canonical option order", () => {
		expect(serializeConfig({
			alignment: "center",
			palette: "secondary",
			personality: "rail",
			density: "compact",
			layout: "multi",
			position: "left",
		})).toBe(
			"config: left, multi, density=compact, personality=rail, palette=secondary, alignment=center",
		);
	});

	test("serializes no marker when all overrides inherit", () => {
		expect(serializeConfig({})).toBe("");
	});
});

describe("configEdit", () => {
	test.each(["\n", "\r\n"])("inserts a config line without changing %j source bytes", (newline) => {
		const source = `tab: One${newline}body${newline}tab: Two`;
		const edit = configEdit(source, { density: "compact" });
		expect(source.slice(0, edit.from) + edit.replacement + source.slice(edit.to)).toBe(
			`config: density=compact${newline}${source}`,
		);
	});

	test("consolidates repeated leading config lines and preserves the remainder", () => {
		const source = "config: left\n\nconfig: multi\n\ntab: One\ntab: Two\n";
		const edit = configEdit(source, { position: "right" });
		expect(source.slice(0, edit.from) + edit.replacement + source.slice(edit.to)).toBe(
			"config: right\n\ntab: One\ntab: Two\n",
		);
	});

	test("does not invent or remove a terminal newline", () => {
		for (const source of [
			"config: left\ntab: One\ntab: Two",
			"config: left\ntab: One\ntab: Two\n",
		]) {
			const edit = configEdit(source, {});
			const rewritten = source.slice(0, edit.from) + edit.replacement + source.slice(edit.to);
			expect(rewritten.endsWith("\n")).toBe(source.endsWith("\n"));
		}
	});

	test("does not treat a config-looking tab body line as leading config", () => {
		const source = "tab: One\nconfig: body\ntab: Two";
		const edit = configEdit(source, { density: "compact" });
		expect(source.slice(0, edit.from) + edit.replacement + source.slice(edit.to)).toBe(
			`config: density=compact\n${source}`,
		);
	});
});
