import { describe, expect, test } from "vitest";
import {
	applySourceEdit,
	captureBlock,
	nestedBlockCandidates,
	rewriteBlock,
	SourceConflictError,
} from "../src/source";

const inner = "tab: One\nA\ntab: Two\nB\n";

function save(text: string, snapshot: ReturnType<typeof captureBlock>): string {
	return applySourceEdit(text, rewriteBlock(text, snapshot, { density: "compact" }));
}

describe("guarded authored block rewrites", () => {
	test("accepts processor source without the fence boundary newline", () => {
		const text = `~~~tabsdown\n${inner}~~~`;
		const rendered = inner.slice(0, -1);
		const snapshot = captureBlock(text, { lineStart: 0, nestedOffsets: [] }, rendered);
		expect(save(text, snapshot)).toBe(
			`~~~tabsdown\nconfig: density=compact\n${inner}~~~`,
		);
	});

	test.each(["\n", "\r\n"])("rewrites the demo callout fixture byte-for-byte with %j", (newline) => {
		const normalized = [
			"tab: Card surface",
			"Use a bordered surface.",
			"tab: Flat tabs",
			"Use tabs directly.",
			"",
		].join("\n");
		const raw = [
			"> [!info] Choose a nested presentation",
			"> ````tabsdown",
			"> tab: Card surface",
			"> Use a bordered surface.",
			"> tab: Flat tabs",
			"> Use tabs directly.",
			"> ````",
		].join(newline);
		const snapshot = captureBlock(raw, { lineStart: 1, nestedOffsets: [] }, normalized);
		expect(save(raw, snapshot)).toBe([
			"> [!info] Choose a nested presentation",
			"> ````tabsdown",
			"> config: density=compact",
			"> tab: Card surface",
			"> Use a bordered surface.",
			"> tab: Flat tabs",
			"> Use tabs directly.",
			"> ````",
		].join(newline));
	});

	test("consolidates quoted config lines without changing surrounding bytes", () => {
		const source = `> ~~~tabsdown\n> config: left\n>\n> config: multi\n>\n> tab: One\n> tab: Two\n> ~~~`;
		const normalized = "config: left\n\nconfig: multi\n\ntab: One\ntab: Two\n";
		const snapshot = captureBlock(source, { lineStart: 0, nestedOffsets: [] }, normalized);
		expect(save(source, snapshot)).toBe(
			"> ~~~tabsdown\n> config: density=compact\n>\n> tab: One\n> tab: Two\n> ~~~",
		);
	});

	test("consolidates CRLF quoted config from LF processor source", () => {
		const source = `> ~~~tabsdown\r\n> config: left\r\n>\r\n> config: multi\r\n>\r\n> tab: One\r\n> tab: Two\r\n> ~~~`;
		const normalized = "config: left\n\nconfig: multi\n\ntab: One\ntab: Two\n";
		const snapshot = captureBlock(source, { lineStart: 0, nestedOffsets: [] }, normalized);
		expect(save(source, snapshot)).toBe(
			"> ~~~tabsdown\r\n> config: density=compact\r\n>\r\n> tab: One\r\n> tab: Two\r\n> ~~~",
		);
	});

	test.each(["\n", "\r\n"])("removes quoted config when every field inherits with %j", (newline) => {
		const source = [
			"> ~~~tabsdown",
			"> config: left, density=compact",
			">",
			"> tab: One",
			"> tab: Two",
			"> ~~~",
		].join(newline);
		const rendered = "config: left, density=compact\n\ntab: One\ntab: Two\n";
		const snapshot = captureBlock(source, { lineStart: 0, nestedOffsets: [] }, rendered);
		const result = applySourceEdit(source, rewriteBlock(source, snapshot, {}));
		expect(result).toBe([
			"> ~~~tabsdown",
			">",
			"> tab: One",
			"> tab: Two",
			"> ~~~",
		].join(newline));
	});

	test.each(["\n", "\r\n"])(
		"preserves mixed quote prefixes before config after a leading blank with %j",
		(newline) => {
			const source = [
				"  > ~~~tabsdown",
				">\t",
				" >\tconfig: left",
				"   > ",
				"> config: multi",
				" >\ttab: One",
				"  > tab: Two",
				"> ~~~",
			].join(newline);
			const normalized = "\nconfig: left\n\nconfig: multi\ntab: One\ntab: Two\n";
			const snapshot = captureBlock(source, { lineStart: 0, nestedOffsets: [] }, normalized);
			expect(save(source, snapshot)).toBe([
				"  > ~~~tabsdown",
				">\t",
				" >\tconfig: density=compact",
				" >\ttab: One",
				"  > tab: Two",
				"> ~~~",
			].join(newline));
		},
	);

	test("preserves a body prefix that differs from the opener spacing", () => {
		const source = "> ~~~tabsdown\n>tab: One\n>tab: Two\n> ~~~";
		const normalized = "tab: One\ntab: Two\n";
		const snapshot = captureBlock(source, { lineStart: 0, nestedOffsets: [] }, normalized);
		expect(save(source, snapshot)).toBe(
			"> ~~~tabsdown\n>config: density=compact\n>tab: One\n>tab: Two\n> ~~~",
		);
	});

	test("selects identical quoted siblings through a depth-two locator", () => {
		const leaf = `~~~tabsdown\n${inner}~~~`;
		const child = `~~~~tabsdown\ntab: Child one\n> ${leaf.replaceAll("\n", "\n> ")}\n> ${leaf.replaceAll("\n", "\n> ")}\ntab: Child two\nDone\n~~~~`;
		const raw = `~~~~~tabsdown\ntab: Outer one\n${child}\ntab: Outer two\nDone\n~~~~~`;
		const outerSource = raw.slice(raw.indexOf("\n") + 1, raw.lastIndexOf("~~~~~"));
		const childCandidate = nestedBlockCandidates(outerSource, 0)[0]!;
		const childSource = child.slice(child.indexOf("\n") + 1, child.lastIndexOf("~~~~"));
		const leaves = nestedBlockCandidates(childSource, 0);
		expect(leaves).toHaveLength(2);
		const snapshot = captureBlock(raw, {
			lineStart: 0,
			nestedOffsets: [childCandidate.offset, leaves[1]!.offset],
		}, inner);
		const result = save(raw, snapshot);
		expect(result.match(/config: density=compact/g)).toHaveLength(1);
		expect(result).toContain("> config: density=compact");
	});

	test("locates a CRLF nested block from LF processor sources", () => {
		const child = `~~~tabsdown\r\n${inner.replaceAll("\n", "\r\n")}~~~`;
		const raw = `~~~~tabsdown\r\ntab: Outer one\r\n${child}\r\ntab: Outer two\r\nDone\r\n~~~~`;
		const outerSource = raw
			.slice(raw.indexOf("\n") + 1, raw.lastIndexOf("~~~~"))
			.replaceAll("\r\n", "\n");
		const candidate = nestedBlockCandidates(outerSource, 0)[0]!;
		const snapshot = captureBlock(raw, { lineStart: 0, nestedOffsets: [candidate.offset] }, inner);
		expect(save(raw, snapshot)).toContain(
			`~~~tabsdown\r\nconfig: density=compact\r\n${inner.replaceAll("\n", "\r\n")}~~~`,
		);
	});

	test("fails closed when quote depth breaks inside a block", () => {
		const raw = `> ~~~tabsdown\n> tab: One\ntab: Two\n> ~~~`;
		expect(() => captureBlock(raw, { lineStart: 0, nestedOffsets: [] }, "tab: One\ntab: Two\n")).toThrow(
			SourceConflictError,
		);
	});

	test.each([
		["~~~", "\n"],
		["````", "\r\n"],
	] as const)("preserves %s fences and %j bytes", (fence, newline) => {
		const body = inner.replaceAll("\n", newline);
		const text = `before${newline}${fence}tabsdown${newline}${body}${fence}${newline}after`;
		const snapshot = captureBlock(text, { lineStart: 1, nestedOffsets: [] }, inner);
		const result = save(text, snapshot);
		expect(result).toBe(
			`before${newline}${fence}tabsdown${newline}config: density=compact${newline}${body}${fence}${newline}after`,
		);
	});

	test.each([
		{ indentation: 1, newline: "\n", quote: "", nested: false },
		{ indentation: 2, newline: "\r\n", quote: "> ", nested: false },
		{ indentation: 3, newline: "\n", quote: "", nested: true },
	] as const)(
		"adds config through CommonMark indentation $indentation with $newline bytes",
		({ indentation, newline, quote, nested }) => {
			const prefix = quote + " ".repeat(indentation);
			const block = [
				`${prefix}~~~tabsdown`,
				...inner.trimEnd().split("\n").map((line) => prefix + line),
				`${prefix}~~~`,
			].join(newline);
			const text = nested
				? [`~~~~tabsdown`, "tab: Outer", block, "tab: Last", "Done", "~~~~"].join(newline)
				: block;
			const locator = nested
				? {
						lineStart: 0,
						nestedOffsets: [nestedBlockCandidates(
							text.slice(text.indexOf(newline) + newline.length, text.lastIndexOf("~~~~")),
							0,
						)[0]!.offset],
					}
				: { lineStart: 0, nestedOffsets: [] };
			const expected = block.replace(
				`${prefix}~~~tabsdown${newline}`,
				`${prefix}~~~tabsdown${newline}${prefix}config: density=compact${newline}`,
			);
			expect(save(text, captureBlock(text, locator, inner))).toBe(
				nested ? text.replace(block, expected) : expected,
			);
		},
	);

	test.each([
		{ indentation: 1, newline: "\r\n", quote: "> ", nested: false },
		{ indentation: 2, newline: "\n", quote: "", nested: true },
		{ indentation: 3, newline: "\r\n", quote: "", nested: false },
	] as const)(
		"rewrites existing config through CommonMark indentation $indentation",
		({ indentation, newline, quote, nested }) => {
			const prefix = quote + " ".repeat(indentation);
			const configured = `config: left\n\nconfig: multi\n\n${inner}`;
			const block = [
				`${prefix}~~~tabsdown`,
				...configured.trimEnd().split("\n").map((line) => prefix + line),
				`${prefix}~~~`,
			].join(newline);
			const text = nested
				? [`~~~~tabsdown`, "tab: Outer", block, "tab: Last", "Done", "~~~~"].join(newline)
				: block;
			const locator = nested
				? {
						lineStart: 0,
						nestedOffsets: [nestedBlockCandidates(
							text.slice(text.indexOf(newline) + newline.length, text.lastIndexOf("~~~~")),
							0,
						)[0]!.offset],
					}
				: { lineStart: 0, nestedOffsets: [] };
			const expectedBody = `config: density=compact\n${inner}`;
			const expected = [
				`${prefix}~~~tabsdown`,
				...expectedBody.trimEnd().replace("\ntab:", "\n\ntab:").split("\n").map((line) => prefix + line),
				`${prefix}~~~`,
			].join(newline);
			expect(save(text, captureBlock(text, locator, configured))).toBe(
				nested ? text.replace(block, expected) : expected,
			);
		},
	);

	test("selects byte-identical top-level blocks by their owning section", () => {
		const block = `~~~tabsdown\n${inner}~~~`;
		const text = `${block}\nprose\n${block}`;
		const snapshot = captureBlock(text, { lineStart: 7, nestedOffsets: [] }, inner);
		const result = save(text, snapshot);
		expect(result.slice(0, block.length)).toBe(block);
		expect(result).toContain("prose\n~~~tabsdown\nconfig: density=compact");
	});

	test("rewrites the selected byte-identical nested block only", () => {
		const text = `~~~~tabsdown\ntab: Outer one\n~~~tabsdown\n${inner}~~~\n~~~tabsdown\n${inner}~~~\ntab: Outer two\nDone\n~~~~`;
		const candidates = nestedBlockCandidates(
			text.slice(text.indexOf("\n") + 1, text.lastIndexOf("~~~~")),
			0,
		);
		expect(candidates).toHaveLength(2);
		const outer = text.slice(text.indexOf("\n") + 1, text.lastIndexOf("~~~~"));
		const snapshot = captureBlock(
			text,
			{ lineStart: 0, nestedOffsets: [candidates[1]!.offset] },
			inner,
		);
		const result = save(text, snapshot);
		expect(result.match(/config: density=compact/g)).toHaveLength(1);
		expect(result.indexOf("config: density=compact")).toBeGreaterThan(
			text.indexOf(outer.slice(candidates[0]!.offset)),
		);
	});

	test("uses parser tab bodies around static fences and ignores invalid backtick info", () => {
		const block = `~~~tabsdown\n${inner}~~~`;
		const source = [
			"tab: First",
			"```text",
			"tab: Structural",
			"```",
			"tab: Nested owner",
			"```bad`info",
			block,
			block,
			"tab: Last",
			"Done",
		].join("\n");

		expect(nestedBlockCandidates(source, 1)).toEqual([]);
		expect(nestedBlockCandidates(source, 2).map(({ source }) => source)).toEqual([
			inner,
			inner,
		]);

		const shortClose = `\`\`\`\`tabsdown\n${inner}\`\`\`\n\`\`\`\`\``;
		expect(nestedBlockCandidates(`tab: Owner\n${shortClose}\ntab: Last`, 0)).toEqual([
			{ offset: 11, source: `${inner}\`\`\`\n` },
		]);
	});

	test("resolves the exact sibling after a parser-structural tab inside a static fence", () => {
		const block = `~~~tabsdown\n${inner}~~~`;
		const source = [
			"tab: First",
			"```text",
			"tab: Structural",
			"tab: Nested owner",
			block,
			block,
			"```",
			"tab: Last",
			"Done",
			"",
		].join("\n");
		const text = `~~~~tabsdown\n${source}~~~~`;
		const candidates = nestedBlockCandidates(source, 2);
		expect(candidates).toHaveLength(2);

		const locator = { lineStart: 0, nestedOffsets: [candidates[1]!.offset] };
		const result = save(text, captureBlock(text, locator, inner));
		const targetStart = text.indexOf(block, text.indexOf(block) + block.length);
		const configured = block.replace(
			"~~~tabsdown\n",
			"~~~tabsdown\nconfig: density=compact\n",
		);
		expect(result).toBe(
			text.slice(0, targetStart) + configured + text.slice(targetStart + block.length),
		);
		const invalid = text.slice(0, targetStart) + text.slice(targetStart).replace("tabsdown", "text    ");
		expect(() => captureBlock(invalid, locator, inner))
			.toThrow(SourceConflictError);
	});

	test("fails closed on any owning-buffer drift", () => {
		const text = `~~~tabsdown\n${inner}~~~`;
		const snapshot = captureBlock(text, { lineStart: 0, nestedOffsets: [] }, inner);
		expect(() => save(`unrelated\n${text}`, snapshot)).toThrow(SourceConflictError);
	});

	test.each([
		["line endings", (text: string) => text.replaceAll("\r\n", "\n")],
		["quote spacing", (text: string) => text.replace("\r\n> tab: One", "\r\n>\ttab: One")],
	])("rejects raw-only note drift in %s", (_name, drift) => {
		const configured = `config: left\n${inner}`;
		const block = `> ~~~tabsdown\r\n> ${configured.slice(0, -1).replaceAll("\n", "\r\n> ")}\r\n> ~~~`;
		const snapshot = captureBlock(block, { lineStart: 0, nestedOffsets: [] }, configured);
		const changed = drift(block);
		expect(() => captureBlock(changed, { lineStart: 0, nestedOffsets: [] }, configured)).not.toThrow();
		expect(() => rewriteBlock(changed, snapshot, { alignment: "center" })).toThrow(
			SourceConflictError,
		);
	});
});
