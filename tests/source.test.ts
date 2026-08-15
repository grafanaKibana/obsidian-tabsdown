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
	test.each([
		{
			name: "a list marker",
			text: `- ~~~tabsdown\n  ${inner.trimEnd().replaceAll("\n", "\n  ")}\n  ~~~`,
			lineStart: 0,
			prefix: "  ",
		},
		{
			name: "four-space list continuation indentation",
			text: `- Parent\n    ~~~tabsdown\n    ${inner.trimEnd().replaceAll("\n", "\n    ")}\n    ~~~`,
			lineStart: 1,
			prefix: "    ",
		},
	] as const)("rewrites a block authored with $name", ({ text, lineStart, prefix }) => {
		const snapshot = captureBlock(text, { lineStart, nestedOffsets: [] }, inner);
		expect(save(text, snapshot)).toBe(
			text.replace(
				text.split("\n")[lineStart] + "\n",
				`${text.split("\n")[lineStart]}\n${prefix}config: density=compact\n`,
			),
		);
	});

	test("inserts config into an empty list-contained block", () => {
		const text = "- ~~~tabsdown\n  ~~~";
		const snapshot = captureBlock(text, { lineStart: 0, nestedOffsets: [] }, "");
		expect(save(text, snapshot)).toBe(
			"- ~~~tabsdown\n  config: density=compact\n  ~~~",
		);
	});

	test("replaces existing config inside a list without changing its prefix", () => {
		const configured = `config: position=left\n${inner}`;
		const text = `- ~~~tabsdown\n  ${configured.trimEnd().replaceAll("\n", "\n  ")}\n  ~~~`;
		const snapshot = captureBlock(text, { lineStart: 0, nestedOffsets: [] }, configured);
		expect(save(text, snapshot)).toBe(
			text.replace("  config: position=left", "  config: density=compact"),
		);
	});

	test("preserves quote and CRLF prefixes inside a list", () => {
		const text = `> - ~~~tabsdown\r\n>   ${inner.trimEnd().replaceAll("\n", "\r\n>   ")}\r\n>   ~~~`;
		const snapshot = captureBlock(text, { lineStart: 0, nestedOffsets: [] }, inner);
		expect(save(text, snapshot)).toBe(
			text.replace("> - ~~~tabsdown\r\n", "> - ~~~tabsdown\r\n>   config: density=compact\r\n"),
		);
	});

	test("preserves tab-indented list continuation bytes", () => {
		const text = `-\t~~~tabsdown\n\t${inner.trimEnd().replaceAll("\n", "\n\t")}\n\t~~~`;
		const snapshot = captureBlock(text, { lineStart: 0, nestedOffsets: [] }, inner);
		expect(save(text, snapshot)).toBe(
			text.replace("-\t~~~tabsdown\n", "-\t~~~tabsdown\n\tconfig: density=compact\n"),
		);
	});

	test("maps a continuation tab across list and fence indentation", () => {
		const text = `- Parent\n\t~~~tabsdown\n\t${inner.trimEnd().replaceAll("\n", "\n\t")}\n\t~~~`;
		const snapshot = captureBlock(text, { lineStart: 1, nestedOffsets: [] }, inner);
		expect(save(text, snapshot)).toBe(
			text.replace("\t~~~tabsdown\n", "\t~~~tabsdown\n\tconfig: density=compact\n"),
		);
	});

	test("does not treat four-space top-level indented code as a block", () => {
		const text = `    ~~~tabsdown\n    ${inner.trimEnd().replaceAll("\n", "\n    ")}\n    ~~~`;
		expect(() => captureBlock(text, { lineStart: 0, nestedOffsets: [] }, inner))
			.toThrow(SourceConflictError);
	});

	test.each(["\n", "\r\n"])(
		"ignores a fence-like frontmatter scalar with %j bytes",
		(newline) => {
			const body = inner.replaceAll("\n", newline);
			const text = `${[
				"---",
				"example: |",
				"  ~~~tabsdown",
				"---",
				"~~~tabsdown",
			].join(newline)}${newline}${body}~~~`;
			const snapshot = captureBlock(text, { lineStart: 4, nestedOffsets: [] }, inner);

			expect(save(text, snapshot)).toBe(
				text.replace(
					`~~~tabsdown${newline}${body}`,
					`~~~tabsdown${newline}config: density=compact${newline}${body}`,
				),
			);
		},
	);

	test("preserves a blockquote nested inside a list item", () => {
		const quoted = inner.trimEnd().replaceAll("\n", "\n  > ");
		const text = `- > ~~~tabsdown\n  > ${quoted}\n  > ~~~`;
		const snapshot = captureBlock(text, { lineStart: 0, nestedOffsets: [] }, inner);

		expect(save(text, snapshot)).toBe(
			text.replace("  > tab: One", "  > config: density=compact\n  > tab: One"),
		);
	});

	test.each([
		{
			name: "nested lists",
			text: `- - ~~~tabsdown\n    ${inner.trimEnd().replaceAll("\n", "\n    ")}\n    ~~~`,
			prefix: "    ",
		},
		{
			name: "alternating lists and blockquotes",
			text: `- > - > ~~~tabsdown\n  >   > ${inner.trimEnd().replaceAll("\n", "\n  >   > ")}\n  >   > ~~~`,
			prefix: "  >   > ",
		},
		{
			name: "consecutive lists before a blockquote",
			text: `- - > ~~~tabsdown\n    > ${inner.trimEnd().replaceAll("\n", "\n    > ")}\n    > ~~~`,
			prefix: "    > ",
		},
	] as const)("preserves $name", ({ text, prefix }) => {
		const snapshot = captureBlock(text, { lineStart: 0, nestedOffsets: [] }, inner);
		expect(save(text, snapshot)).toBe(
			text.replace(`${prefix}tab: One`, `${prefix}config: density=compact\n${prefix}tab: One`),
		);
	});

	test.each([
		{ newline: "\n", rendered: inner },
		{ newline: "\n", rendered: inner.slice(0, -1) },
		{ newline: "\r\n", rendered: inner },
	] as const)("treats EOF as the close of an unclosed block with $newline bytes", ({ newline, rendered }) => {
		const body = rendered.replaceAll("\n", newline);
		const text = `~~~tabsdown${newline}${body}`;
		const snapshot = captureBlock(text, { lineStart: 0, nestedOffsets: [] }, rendered);
		expect(save(text, snapshot)).toBe(
			`~~~tabsdown${newline}config: density=compact${newline}${body}`,
		);
	});

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
		const source = `> ~~~tabsdown\n> config: position=left\n>\n> config: layout=multi\n>\n> tab: One\n> tab: Two\n> ~~~`;
		const normalized = "config: position=left\n\nconfig: layout=multi\n\ntab: One\ntab: Two\n";
		const snapshot = captureBlock(source, { lineStart: 0, nestedOffsets: [] }, normalized);
		expect(save(source, snapshot)).toBe(
			"> ~~~tabsdown\n> config: density=compact\n>\n> tab: One\n> tab: Two\n> ~~~",
		);
	});

	test("consolidates CRLF quoted config from LF processor source", () => {
		const source = `> ~~~tabsdown\r\n> config: position=left\r\n>\r\n> config: layout=multi\r\n>\r\n> tab: One\r\n> tab: Two\r\n> ~~~`;
		const normalized = "config: position=left\n\nconfig: layout=multi\n\ntab: One\ntab: Two\n";
		const snapshot = captureBlock(source, { lineStart: 0, nestedOffsets: [] }, normalized);
		expect(save(source, snapshot)).toBe(
			"> ~~~tabsdown\r\n> config: density=compact\r\n>\r\n> tab: One\r\n> tab: Two\r\n> ~~~",
		);
	});

	test.each(["\n", "\r\n"])("removes quoted config when every field inherits with %j", (newline) => {
		const source = [
			"> ~~~tabsdown",
			"> config: position=left, density=compact",
			">",
			"> tab: One",
			"> tab: Two",
			"> ~~~",
		].join(newline);
		const rendered = "config: position=left, density=compact\n\ntab: One\ntab: Two\n";
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
				" >\tconfig: position=left",
				"   > ",
				"> config: layout=multi",
				" >\ttab: One",
				"  > tab: Two",
				"> ~~~",
			].join(newline);
			const normalized = "\nconfig: position=left\n\nconfig: layout=multi\ntab: One\ntab: Two\n";
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
			const configured = `config: position=left\n\nconfig: layout=multi\n\n${inner}`;
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

	test("ignores commented fences and stops at an unclosed static fence", () => {
		const block = `~~~tabsdown\n${inner}~~~`;
		const source = [
			"tab: Owner",
			"<!--",
			block,
			"-->",
			block,
			"```text",
			block,
		].join("\n");

		expect(nestedBlockCandidates(source, 0)).toEqual([
			{ offset: source.indexOf(block, source.indexOf(block) + 1), source: inner },
		]);
	});

	test("ignores fences inside raw HTML blocks without suppressing inline HTML", () => {
		const block = `~~~tabsdown\n${inner}~~~`;
		const source = [
			"tab: Owner",
			"<pre>",
			block,
			"</pre>",
			"<div>",
			block,
			"",
			"<span>",
			block,
			"",
			"Text with <span>inline HTML</span>.",
			block,
		].join("\n");

		expect(nestedBlockCandidates(source, 0)).toEqual([
			{ offset: source.lastIndexOf(block), source: inner },
		]);
	});

	test("requires a complete raw HTML closing tag", () => {
		const block = `~~~tabsdown\n${inner}~~~`;
		const source = [
			"tab: Owner",
			"<script>",
			"</scripture>",
			block,
			"</script>",
			block,
		].join("\n");

		expect(nestedBlockCandidates(source, 0)).toEqual([
			{ offset: source.lastIndexOf(block), source: inner },
		]);
	});

	test.each([
		["%%", "%%"],
		["Text %% hidden", "still hidden %%"],
	])("ignores nested blocks inside Obsidian comments: %j", (open, close) => {
		const block = `~~~tabsdown\n${inner}~~~`;
		const source = ["tab: Owner", open, block, close, block].join("\n");

		expect(nestedBlockCandidates(source, 0)).toEqual([
			{ offset: source.lastIndexOf(block), source: inner },
		]);
	});

	test.each(["%% hidden %%", "`%%`"])(
		"does not carry a closed Obsidian comment from %j",
		(marker) => {
			const block = `~~~tabsdown\n${inner}~~~`;
			const source = ["tab: Owner", marker, block].join("\n");

			expect(nestedBlockCandidates(source, 0)).toEqual([
				{ offset: source.indexOf(block), source: inner },
			]);
		},
	);

	test.each([
		["an indented code block", ["    %%"]],
		["a multiline code span", ["`literal", "%%", "code span`"]],
		["a multiline code span with a delimiter row", ["`literal", "| --- |", "%%", "code span`"]],
	] as const)("ignores comment markers inside %s", (_name, code) => {
		const block = `~~~tabsdown\n${inner}~~~`;
		const source = ["tab: Owner", ...code, block].join("\n");

		expect(nestedBlockCandidates(source, 0)).toEqual([
			{ offset: source.indexOf(block), source: inner },
		]);
	});

	test("does not close an inline code span across a fenced block", () => {
		const block = `~~~tabsdown\n${inner}~~~`;
		const source = ["tab: Owner", "`literal", block, "`"].join("\n");

		expect(nestedBlockCandidates(source, 0)).toEqual([
			{ offset: source.indexOf(block), source: inner },
		]);
	});

	test("does not continue a reference label across a fenced block", () => {
		const block = `~~~tabsdown\n${inner}~~~`;
		const source = ["tab: Owner", "[", block, "]: /url"].join("\n");

		expect(nestedBlockCandidates(source, 0)).toEqual([
			{ offset: source.indexOf(block), source: inner },
		]);
	});

	test("scans a long unclosed reference title without swallowing a fence", () => {
		const block = `~~~tabsdown\n${inner}~~~`;
		const source = [
			"tab: Owner",
			"[ref]: /url \"unclosed",
			...Array.from({ length: 8_000 }, () => "continuation"),
			block,
		].join("\n");

		expect(nestedBlockCandidates(source, 0)).toEqual([
			{ offset: source.indexOf(block), source: inner },
		]);
	});

	test.each([
		{ html: "<!--", prefix: "> " },
		{ html: "<div>", prefix: "> " },
		{ html: "<div>", prefix: "- " },
	])(
		"stops an unclosed $html HTML block at the end of its Markdown container",
		({ html, prefix }) => {
			const block = `~~~tabsdown\n${inner}~~~`;
			const text = `${prefix}${html}\n${block}`;
			const snapshot = captureBlock(text, { lineStart: 1, nestedOffsets: [] }, inner);
			expect(save(text, snapshot)).toBe(
				text.replace(block, `~~~tabsdown\nconfig: density=compact\n${inner}~~~`),
			);
		},
	);

	test.each([
		["paragraph"],
		["paragraph", "[ref]: /url"],
		["Header", "| --- |"],
		["| One | Two |", "| --- |"],
		["[ref]: <broken"],
		["[ref]: /foo(bar"],
		["[   ]: /url"],
		["[a[b]: /url"],
		["[ref]: /url", "    code", "\"title\""],
	])("does not let a complete HTML tag interrupt %j", (...paragraph) => {
		const block = `~~~tabsdown\n${inner}~~~`;
		const source = [
			"tab: Owner",
			...paragraph,
			"<span>",
			block,
		].join("\n");

		expect(nestedBlockCandidates(source, 0)).toEqual([
			{ offset: source.indexOf(block), source: inner },
		]);
	});

	test.each(["2. item", "2) item"])(
		"keeps a non-1 ordered marker inside its paragraph: %s",
		(marker) => {
			const block = `~~~tabsdown\n${inner}~~~`;
			const source = [
				"tab: Owner",
				"paragraph",
				marker,
				"<span>",
				block,
			].join("\n");

			expect(nestedBlockCandidates(source, 0)).toEqual([
				{ offset: source.indexOf(block), source: inner },
			]);
		},
	);

	test.each(["+ ", "1. "])(
		"keeps a blank list marker inside its paragraph: %j",
		(marker) => {
			const block = `~~~tabsdown\n${inner}~~~`;
			const source = [
				"tab: Owner",
				"paragraph",
				marker,
				"<span>",
				block,
			].join("\n");

			expect(nestedBlockCandidates(source, 0)).toEqual([
				{ offset: source.indexOf(block), source: inner },
			]);
		},
	);

	test("rejects a long malformed complete HTML tag without backtracking", () => {
		const block = `~~~tabsdown\n${inner}~~~`;
		const malformed = `<span ${"!\t\t:=".repeat(500)}>`;
		const source = ["tab: Owner", malformed, block].join("\n");

		expect(nestedBlockCandidates(source, 0)).toEqual([
			{ offset: source.indexOf(block), source: inner },
		]);
	});

	test.each([
		{ boundary: ["# Heading"] },
		{ boundary: ["[ref]: /url"] },
		{ boundary: ["[ref]:/url"] },
		{ boundary: ["[ref]: /foo(bar)"] },
		{ boundary: ["[ref]: foo<bar"] },
		{ boundary: ["[\\ ]: /url"] },
		{ boundary: ["[a\\[b]: /url"] },
		{ boundary: ["[ ]: /url"] },
		{ boundary: ["[ref]:", "  /url"] },
		{ boundary: ["[ref]: /url", "  \"title\""] },
		{ boundary: ["[ref]: /url \"long", "title\""] },
		{ boundary: ["[ref]: /url", "\"long", "title\""] },
		{ boundary: ["[", "foo", "]: /url"] },
		{ boundary: ["paragraph", "1. item"] },
		{ boundary: ["| Header |", "| --- |"] },
		{ boundary: ["| Header |", "| - |"] },
		{ boundary: ["paragraph", "# Heading"] },
		{ boundary: ["paragraph", "***"] },
		{ boundary: ["paragraph", "___"] },
		{ boundary: ["---"] },
		{ boundary: ["Heading", "---"] },
		{ boundary: ["    indented code"] },
	])("recognizes type-7 HTML after the $boundary block boundary", ({ boundary }) => {
		const block = `~~~tabsdown\n${inner}~~~`;
		const source = [
			"tab: Owner",
			...boundary,
			"<span>",
			block,
			"",
			block,
		].join("\n");

		expect(nestedBlockCandidates(source, 0)).toEqual([
			{ offset: source.lastIndexOf(block), source: inner },
		]);
	});

	test("accepts a maximum-length reference label after three spaces", () => {
		const block = `~~~tabsdown\n${inner}~~~`;
		const source = [
			"tab: Owner",
			`   [${"x".repeat(999)}]: /url`,
			"<span>",
			block,
		].join("\n");

		expect(nestedBlockCandidates(source, 0)).toEqual([]);
	});

	test("does not start type-7 HTML inside a quoted paragraph", () => {
		const quoted = `> ~~~tabsdown\n> ${inner.trimEnd().replaceAll("\n", "\n> ")}\n> ~~~`;
		const source = [
			"tab: Owner",
			"> paragraph",
			"> <span>",
			quoted,
		].join("\n");

		expect(nestedBlockCandidates(source, 0)).toEqual([
			{ offset: source.indexOf(quoted), source: inner },
		]);
	});

	test("removes at most one optional boundary newline", () => {
		const text = `~~~tabsdown\n${inner}\n~~~`;
		expect(() => captureBlock(
			text,
			{ lineStart: 0, nestedOffsets: [] },
			inner.slice(0, -1),
		)).toThrow(SourceConflictError);
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
		const configured = `config: position=left\n${inner}`;
		const block = `> ~~~tabsdown\r\n> ${configured.slice(0, -1).replaceAll("\n", "\r\n> ")}\r\n> ~~~`;
		const snapshot = captureBlock(block, { lineStart: 0, nestedOffsets: [] }, configured);
		const changed = drift(block);
		expect(() => captureBlock(changed, { lineStart: 0, nestedOffsets: [] }, configured)).not.toThrow();
		expect(() => rewriteBlock(changed, snapshot, { alignment: "center" })).toThrow(
			SourceConflictError,
		);
	});
});
