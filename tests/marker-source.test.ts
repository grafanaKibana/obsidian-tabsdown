import { describe, expect, test } from "vitest";
import { commentMarkers } from "../src/syntax";
import { parseTabs } from "../src/parser";
import { applySourceEdit, captureBlock, rewriteBlock, rewriteTab, rewriteTabBody, sourceBlocks, tabBodyPosition } from "../src/source";
const inner = "%% tab: One %%\n\nAlpha\n\n%% tab: Two %%\nBeta\n";
const layout = `%% tabs %%\n${inner}%% endtabs %%`;
function snapshot(text: string, index = 0) {
	const block = sourceBlocks(text)[index]!;
	return captureBlock(text, block.locator, block.source);
}
describe("comment marker source", () => {
	test("parses labels, config and preserves ordinary Markdown", () => {
		const result = parseTabs(`%% config: position=left %%\n${inner}`, "markers");
		expect(result).toMatchObject({ ok: true, tabs: [{ label: "One", body: "\nAlpha\n\n" }, { label: "Two", body: "Beta\n" }], options: { position: "left" } });
	});
	test.each(["", " ", "  ", "   "])("discovers own-line markers indented %j", (indent) => {
		const text = layout.split("\n").map((line) => indent + line).join("\n");
		expect(sourceBlocks(text)).toHaveLength(1);
		expect(sourceBlocks(text)[0]?.syntax).toBe("markers");
	});
	test.each(["\n", "\r\n"])("rewrites bodies and settings preserving %j", (newline) => {
		const text = layout.replaceAll("\n", newline);
		const block = sourceBlocks(text)[0]!;
		expect(block.bodyRanges.map((range) => range.text)).toEqual(["\nAlpha\n", "Beta"]);
		expect(tabBodyPosition(text, snapshot(text), 0, 1)).toBe(text.indexOf("Alpha"));
		expect(block.lineEnd).toBe(7);
		const saved = applySourceEdit(text, rewriteTabBody(text, snapshot(text), 0, "\nNew\nBody\n"));
		expect(saved).toBe(text.replace("Alpha", `New${newline}Body`));
		expect(applySourceEdit(text, rewriteTabBody(text, snapshot(text), 0, ""))).toBe(text.replace(`${newline}Alpha${newline}`, ""));
		expect(applySourceEdit(text, rewriteBlock(text, snapshot(text), { density: "compact" }))).toBe(text.replace(`%% tabs %%${newline}`, `%% tabs %%${newline}%% config: density=compact %%${newline}`));
		expect(applySourceEdit(text, rewriteTab(text, snapshot(text), { type: "rename", index: 1, label: "Last" }))).toBe(text.replace("tab: Two", "tab: Last"));
		expect(applySourceEdit(text, rewriteTab(text, snapshot(text), { type: "add", label: "Third" }))).toBe(text.replace("%% endtabs %%", `%% tab: Third %%${newline}%% endtabs %%`));
	});
	test("maps quote/list prefixes and nested offsets", () => {
		const text = "> - " + layout.replaceAll("\n", "\n>   ");
		expect(sourceBlocks(text)).toHaveLength(1);
		expect(applySourceEdit(text, rewriteTabBody(text, snapshot(text), 0, "\nNew\nBody\n"))).toBe(text.replace("Alpha", "New\n>   Body"));
	});
	test("discovers both nesting directions", () => {
		const fenced = "```tabsdown\ntab: A\na\ntab: B\nb\n```";
		for (const text of [layout.replace("Alpha", fenced), "````tabsdown\ntab: A\n" + layout + "\ntab: B\nb\n````"]) {
			const blocks = sourceBlocks(text);
			expect(blocks).toHaveLength(2);
			expect(blocks[1]?.locator.nestedOffsets).toHaveLength(1);
			expect(() => snapshot(text, 1)).not.toThrow();
		}
	});
	test.each(["```md\n%s\n```", "%% hidden\n%s\n%%", "<!--\n%s\n-->", "$$\n%s\n$$", "<pre>\n%s\n</pre>"])("ignores literal %s", (wrapper) => {
		expect(sourceBlocks(wrapper.replace("%s", layout))).toEqual([]);
	});
	test("ignores marker-looking tab comments inside fenced literals", () => {
		const source = inner.replace("Alpha", "```md\n%% tab: Literal %%\n%% tabs %%\n%% endtabs %%\n```");
		expect(parseTabs(source, "markers")).toMatchObject({ ok: true, tabs: [{ label: "One" }, { label: "Two" }] });
	});
	test("keeps incomplete layouts and frontmatter as source", () => {
		expect(sourceBlocks(layout.replace("%% endtabs %%", ""))).toEqual([]);
		const text = `---\n${layout}\n---\n`;
		expect(sourceBlocks(text)).toEqual([]);
		expect(sourceBlocks(text, { fragment: true })).toHaveLength(1);
	});
	test.each([0, 1])("inserts into an empty tab %i without consuming the next delimiter", (index) => {
		const text = "%% tabs %%\n%% tab: One %%\n%% tab: Two %%\n%% endtabs %%";
		const expected = index === 0 ? text.replace("%% tab: Two %%", "New\n%% tab: Two %%") : text.replace("%% endtabs %%", "New\n%% endtabs %%");
		expect(applySourceEdit(text, rewriteTabBody(text, snapshot(text), index, "New"))).toBe(expected);
	});
	test.each(["```js", "%% unfinished", "<!-- unfinished", "%% tab: Newly authored %%", "%% endtabs %%"])("saves arbitrary in-progress body Markdown %j verbatim", (body) => {
		const text = "%% tabs %%\n%% tab: One %%\nAlpha\n%% tab: Two %%\nBeta\n%% endtabs %%";
		expect(applySourceEdit(text, rewriteTabBody(text, snapshot(text), 0, body))).toBe(text.replace("Alpha", body));
		expect(() => rewriteTabBody(text + "changed", snapshot(text), 0, body)).toThrow();
	});
	test("retains delimiters and CRLF when deleting a whole body", () => {
		const text = "```tabsdown\r\ntab: One\r\nAlpha\r\ntab: Two\r\nBeta\r\n```";
		expect(applySourceEdit(text, rewriteTabBody(text, snapshot(text), 0, ""))).toBe(text.replace("Alpha", ""));
	});
	test("requires exact inline code runs and hides midline HTML comments", () => {
		const marker = "%% tab: Real %%";
		expect(commentMarkers("text `` unmatched\n" + marker + "\n```\n").map((control) => control.value)).toEqual(["Real"]);
		expect(commentMarkers("text `` matched\n" + marker + "\n``\n")).toEqual([]);
		expect(commentMarkers("text <!-- hidden\n" + marker + "\n-->\n" + marker).map((control) => control.value)).toEqual(["Real"]);
		expect(commentMarkers("text <!-- %% hidden -->\n" + marker).map((control) => control.value)).toEqual(["Real"]);
	});
	for (const syntax of ["markers", "fenced"] as const) {
		for (const container of ["quote", "list"] as const) {
			for (const newline of ["\n", "\r\n"]) {
				for (const index of [0, 1]) {
					test(`preserves ${syntax} ${container} empty tab ${index} with ${JSON.stringify(newline)} multiline edits`, () => {
						const prefix = container === "quote" ? "> " : "  ";
						const opening = syntax === "markers" ? "%% tabs %%" : "```tabsdown";
						const closing = syntax === "markers" ? "%% endtabs %%" : "```";
						const tab = (label: string) => syntax === "markers" ? `%% tab: ${label} %%` : `tab: ${label}`;
						const original = [opening, tab("One"), tab("Two"), closing];
						const authored = (rows: string[]) => rows.map((row, number) => (number === 0 && container === "list" ? "- " : prefix) + row).join(newline);
						const text = authored(original);
						const expected = [...original];
						expected.splice(index + 2, 0, "New", "Body");
						const saved = applySourceEdit(text, rewriteTabBody(text, snapshot(text), index, "New\nBody"));
						expect(saved).toBe(authored(expected));
						expect(sourceBlocks(saved)).toHaveLength(1);
						expect(sourceBlocks(saved)[0]?.bodyRanges[index]?.text).toBe("New\nBody");
						expect(tabBodyPosition(saved, snapshot(saved), index, 4)).toBe(saved.indexOf("Body"));
						const updated = applySourceEdit(saved, rewriteTabBody(saved, snapshot(saved), index, "Again\nMore"));
						expect(updated).toBe(saved.replace("New", "Again").replace("Body", "More"));
						expect(sourceBlocks(updated)[0]?.bodyRanges[index]?.text).toBe("Again\nMore");
					});
				}
			}
		}
	}
	test.each(["Text\n<span>inline</span>", "Text\n<span>", "Text\n<widget attr='value'>"])("retains inline HTML within an open paragraph: %j", (body) => {
		const text = layout.replace("Alpha", body);
		expect(sourceBlocks(text)).toHaveLength(1);
		expect(parseTabs(sourceBlocks(text)[0]!.source, "markers")).toMatchObject({ ok: true, tabs: [{ label: "One" }, { label: "Two" }] });
	});
	test.each(["<span>", "<div>", "<span attr='value'>"])("still hides marker-looking text in true HTML blocks: %j", (tag) => {
		const text = layout.replace("Alpha", `${tag}\n%% tab: Hidden %%\n</span>\n`);
		expect(sourceBlocks(text)).toHaveLength(1);
		expect(parseTabs(sourceBlocks(text)[0]!.source, "markers")).toMatchObject({ ok: true, tabs: [{ label: "One" }, { label: "Two" }] });
	});
	for (const container of ["plain", "quote", "list"] as const) {
		for (const newline of ["\n", "\r\n"]) {
			test(`edits an empty final EOF tab in ${container} with ${JSON.stringify(newline)}`, () => {
				const prefix = container === "quote" ? "> " : container === "list" ? "  " : "";
				const first = container === "list" ? "- " : prefix;
				const text = first + "```tabsdown" + newline + prefix + "tab: One" + newline + prefix + "A" + newline + prefix + "tab: Two";
				const saved = applySourceEdit(text, rewriteTabBody(text, snapshot(text), 1, "New\nBody"));
				expect(saved).toBe(text + newline + prefix + "New" + newline + prefix + "Body");
				expect(sourceBlocks(saved)).toHaveLength(1);
				expect(sourceBlocks(saved)[0]?.bodyRanges[1]?.text).toBe("New\nBody");
				expect(tabBodyPosition(saved, snapshot(saved), 1, 4)).toBe(saved.indexOf("Body"));
			});
		}
	}
	test("rejects stale writes and duplicate labels", () => {
		expect(() => rewriteTabBody(layout + "x", snapshot(layout), 0, "New")).toThrow();
		expect(parseTabs(inner.replace("Two", "One"), "markers")).toMatchObject({ ok: false, diagnostic: { code: "duplicate-label" } });
	});
});
