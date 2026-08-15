import { configEdit, type TabsdownConfig } from "./config";
import { isTabsdownFence, parseFenceLine } from "./parser";

export interface BlockLocator {
	lineStart: number;
	nestedOffsets: number[];
}

export interface BlockSnapshot {
	locator: BlockLocator;
	text: string;
	target: string;
	rawTarget: string;
}

export interface SourceEdit {
	from: number;
	to: number;
	replacement: string;
}

interface SourceView {
	text: string;
	rawFrom: number[];
	rawTo: number[];
}

interface FenceBlock {
	open: number;
	inner: SourceView;
	innerRawFrom: number;
	innerRawTo: number;
	closeEnd: number;
	prefix: string;
	innerHasLine: boolean;
}

interface SourceLine {
	start: number;
	end: number;
	contentEnd: number;
}

interface SourceRange {
	from: number;
	to: number;
}

const listMarker = /^( {0,3})([-+*]|\d{1,9}[.)])([ \t]+)/;
const footnoteMarker = /^( {0,3})\[\^[^\]\n]+\]:(?:[ \t]+|$)/;
const htmlBlockTag = /^(?: {0,3})<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t/>]|$)/i;
const htmlTagName = /[A-Za-z][A-Za-z0-9-]*/y;
const htmlAttribute = /[ \t]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \t]*=[ \t]*(?:[^ "'=<>`]+|'[^']*'|"[^"]*"))?/y;
const htmlClosingTagTail = /[ \t]*>[ \t]*$/y;
const htmlTagClose = /[ \t]*\/?>[ \t]*$/y;
const atxHeading = /^ {0,3}#{1,6}(?:[ \t]+|$)/;
const setextHeading = /^ {0,3}(?:=+|-+)[ \t]*$/;
const thematicBreak = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,})$/;
const tableDelimiter = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const linkLabel = String.raw`\[(?:\\[\s\S]|[^\]\\])+\]:`;
const frontmatterFence = /^---[ \t]*$/;
const displayMathFence = /^ {0,3}\$\$[ \t]*$/;

export class SourceConflictError extends Error {}

function isCompleteHtmlTag(line: string): boolean {
	const leading = /^ {0,3}/.exec(line)?.[0].length ?? 0;
	let index = leading;
	if (line[index] !== "<") return false;
	index += 1;
	if (line[index] === "/") index += 1;
	htmlTagName.lastIndex = index;
	const name = htmlTagName.exec(line);
	if (!name) return false;
	index = htmlTagName.lastIndex;
	if (line[leading + 1] === "/") {
		htmlClosingTagTail.lastIndex = index;
		return htmlClosingTagTail.test(line);
	}
	while (index < line.length) {
		htmlTagClose.lastIndex = index;
		if (htmlTagClose.test(line)) return true;
		htmlAttribute.lastIndex = index;
		if (!htmlAttribute.test(line)) return false;
		index = htmlAttribute.lastIndex;
	}
	return false;
}

function tableColumnCount(line: string): number {
	let pipes = 0;
	let first = -1;
	let last = -1;
	for (let index = 0; index < line.length; index += 1) {
		if (line[index] !== "|") continue;
		let slashes = 0;
		for (let cursor = index - 1; cursor >= 0 && line[cursor] === "\\"; cursor -= 1) {
			slashes += 1;
		}
		if (slashes % 2 === 1) continue;
		if (first < 0) first = index;
		last = index;
		pipes += 1;
	}
	const start = line.search(/\S/);
	const end = line.search(/\s*$/) - 1;
	return pipes + 1 - Number(first >= 0 && first === start) -
		Number(last >= 0 && last === end);
}

type LinkReferenceStatus =
	| "complete"
	| "destination"
	| "invalid"
	| "possible"
	| "title-double"
	| "title-paren"
	| "title-single";

function linkReferenceStatus(sourceLines: string[]): LinkReferenceStatus {
	const source = sourceLines.join("\n");
	const label = new RegExp(`^ {0,3}${linkLabel}`).exec(source);
	if (!label) {
		if (!/^ {0,3}\[/.test(source) || source.length > 1003) return "invalid";
		let escaped = false;
		for (const character of source.slice(source.indexOf("[") + 1)) {
			if (escaped) escaped = false;
			else if (character === "\\") escaped = true;
			else if (character === "]") return "invalid";
		}
		return "possible";
	}
	const labelStart = label[0].indexOf("[");
	const labelBody = label[0].slice(labelStart + 1, -2);
	let labelEscape = false;
	for (const character of labelBody) {
		if (labelEscape) labelEscape = false;
		else if (character === "\\") labelEscape = true;
		else if (character === "[") return "invalid";
	}
	if (![...labelBody].some((character) => ![" ", "\t", "\n"].includes(character))) {
		return "invalid";
	}
	if ([...labelBody].length > 999) return "invalid";
	let index = label[0].length;
	while (source[index] === " " || source[index] === "\t") index += 1;
	if (source[index] === "\n") {
		index += 1;
		let indent = 0;
		while (indent < 3 && source[index] === " ") {
			index += 1;
			indent += 1;
		}
	}
	if (index >= source.length) return "possible";
	if (source[index] === "<") {
		let escaped = false;
		let closed = false;
		for (index += 1; index < source.length && source[index] !== "\n"; index += 1) {
			const character = source[index]!;
			if (escaped) escaped = false;
			else if (character === "\\") escaped = true;
			else if (character === "<") return "invalid";
			else if (character === ">") {
				index += 1;
				closed = true;
				break;
			}
		}
		if (!closed) return "invalid";
	} else {
		let balance = 0;
		let escaped = false;
		const start = index;
		while (index < source.length && !/[ \t\n]/.test(source[index]!)) {
			const character = source[index]!;
			const code = character.charCodeAt(0);
			if (escaped) escaped = false;
			else if (character === "\\") escaped = true;
			else if (code < 32 || code === 127) return "invalid";
			else if (character === "(") balance += 1;
			else if (character === ")" && --balance < 0) return "invalid";
			index += 1;
		}
		if (index === start || balance !== 0) return "invalid";
	}
	if (index >= source.length) return "destination";
	if (!/[ \t\n]/.test(source[index]!)) return "invalid";
	while (source[index] === " " || source[index] === "\t") index += 1;
	if (source[index] === "\n") {
		index += 1;
		let indent = 0;
		while (indent < 3 && source[index] === " ") {
			index += 1;
			indent += 1;
		}
	}
	if (index >= source.length) return "destination";
	const opener = source[index];
	const closer = opener === "(" ? ")" : opener;
	if (!closer || !["\"", "'", ")"].includes(closer)) return "invalid";
	if (/\n[ \t]*\n/.test(source.slice(index))) return "invalid";
	let escaped = false;
	for (index += 1; index < source.length; index += 1) {
		const character = source[index]!;
		if (escaped) escaped = false;
		else if (character === "\\") escaped = true;
		else if (character === closer) {
			return /^[ \t]*$/.test(source.slice(index + 1)) ? "complete" : "invalid";
		}
	}
	return closer === "\"" ? "title-double" : closer === "'" ? "title-single" : "title-paren";
}

function titleCloser(status: LinkReferenceStatus): string | undefined {
	if (status === "title-double") return "\"";
	if (status === "title-single") return "'";
	if (status === "title-paren") return ")";
	return undefined;
}

function continuedTitleStatus(line: string, closer: string): "complete" | "invalid" | "possible" {
	let escaped = false;
	for (let index = 0; index < line.length; index += 1) {
		const character = line[index]!;
		if (escaped) escaped = false;
		else if (character === "\\") escaped = true;
		else if (character === closer) {
			return /^[ \t]*$/.test(line.slice(index + 1)) ? "complete" : "invalid";
		}
	}
	return "possible";
}

function listItemPrefix(match: RegExpExecArray): { indent: number; length: number } {
	const markerIndent = match[1]!.length;
	const markerEndLength = match[0].length - match[3]!.length;
	const markerEndColumn = markerIndent + match[2]!.length;
	const padding = indentation(match[3]!, markerEndColumn);
	const paddingLength = padding.columns > 4 ? 1 : padding.length;
	return {
		indent: markerEndColumn + indentation(
			match[3]!.slice(0, paddingLength),
			markerEndColumn,
		).columns,
		length: markerEndLength + paddingLength,
	};
}

function listMarkerInterruptsParagraph(line: string, marker: RegExpExecArray): boolean {
	return line.slice(marker[0].length).trim() !== "" && (
		!/^\d/.test(marker[2]!) || Number.parseInt(marker[2]!, 10) === 1
	);
}

function interruptsParagraph(line: string, previousLine: string): boolean {
	const marker = listMarker.exec(line);
	const list = marker && listMarkerInterruptsParagraph(line, marker);
	const table = previousLine.includes("|") && line.includes("|") &&
		tableDelimiter.test(line) &&
		tableColumnCount(previousLine) === tableColumnCount(line);
	return Boolean(
		parseFenceLine(line) ||
		atxHeading.test(line) ||
		setextHeading.test(line) ||
		thematicBreak.test(line) ||
		table ||
		list ||
		/^ {0,3}>/.test(line) ||
		/^ {0,3}(?:<!--|<\?|<!\[CDATA\[|<![A-Z]|<(?:script|pre|style|textarea)(?:[ \t>]|$))/i.test(line) ||
		htmlBlockTag.test(line)
	);
}

function stripObsidianComments(
	line: string,
	open: boolean,
	codeRun: number,
	source: string,
	remainingFrom: number,
): { text: string; open: boolean; codeRun: number; touched: boolean } {
	const closingBackticks = (source: string, from: number, length: number): number => {
		const run = "`".repeat(length);
		for (let close = source.indexOf(run, from); close >= 0; ) {
			if (source[close - 1] !== "`" && source[close + length] !== "`") return close;
			close = source.indexOf(run, close + length);
		}
		return -1;
	};
	let text = "";
	let touched = open;
	for (let index = 0; index < line.length; ) {
		if (open) {
			const close = line.indexOf("%%", index);
			if (close < 0) return { text, open, codeRun: 0, touched: true };
			open = false;
			touched = true;
			index = close + 2;
			continue;
		}
		if (codeRun > 0) {
			const close = closingBackticks(line, index, codeRun);
			if (close < 0) return { text: text + line.slice(index), open, codeRun, touched };
			text += line.slice(index, close + codeRun);
			index = close + codeRun;
			codeRun = 0;
			continue;
		}
		if (line.startsWith("%%", index)) {
			open = true;
			touched = true;
			index += 2;
			continue;
		}
		if (line[index] === "`") {
			let runEnd = index + 1;
			while (line[runEnd] === "`") runEnd += 1;
			const length = runEnd - index;
			const close = closingBackticks(line, runEnd, length);
			if (close >= 0) {
				text += line.slice(index, close + length);
				index = close + length;
				continue;
			}
			if (closingBackticks(source, remainingFrom, length) >= 0) {
				return { text: text + line.slice(index), open, codeRun: length, touched };
			}
		}
		text += line[index] ?? "";
		index += 1;
	}
	return { text, open, codeRun, touched };
}

function createSourceView(source: string, rawOffset = 0): SourceView {
	const view: SourceView = { text: "", rawFrom: [rawOffset], rawTo: [rawOffset] };
	for (let index = 0; index < source.length; index += 1) {
		if (source[index] === "\r" && source[index + 1] === "\n") index += 1;
		view.text += source[index] ?? "";
		view.rawFrom.push(rawOffset + index + 1);
		view.rawTo.push(rawOffset + index + 1);
	}
	return view;
}

function lines(source: string, from = 0, to = source.length): SourceLine[] {
	const result: SourceLine[] = [];
	for (let start = from; start < to; ) {
		const newline = source.indexOf("\n", start);
		const end = newline < 0 || newline >= to ? to : newline + 1;
		const contentEnd = end > start && source[end - 1] === "\n"
			? end - (end > start + 1 && source[end - 2] === "\r" ? 2 : 1)
			: end;
		result.push({ start, end, contentEnd });
		start = end;
	}
	return result;
}

function frontmatterEnd(source: string): number {
	const sourceLines = lines(source);
	const first = sourceLines[0];
	if (!first || !frontmatterFence.test(source.slice(first.start, first.contentEnd))) return 0;
	for (const line of sourceLines.slice(1)) {
		if (frontmatterFence.test(source.slice(line.start, line.contentEnd))) return line.end;
	}
	return 0;
}

function quotePrefix(
	line: string,
	maxIndent = 3,
	maxDepth = Number.POSITIVE_INFINITY,
): { depth: number; length: number } {
	let depth = 0;
	let offset = 0;
	while (offset < line.length && depth < maxDepth) {
		let marker = offset;
		while (marker < line.length && marker - offset < maxIndent && line[marker] === " ") {
			marker += 1;
		}
		if (line[marker] !== ">") break;
		offset = marker + 1;
		if (line[offset] === " " || line[offset] === "\t") offset += 1;
		depth += 1;
	}
	return { depth, length: offset };
}

function indentation(line: string, initialColumn = 0): { columns: number; length: number } {
	let column = initialColumn;
	let length = 0;
	while (length < line.length) {
		if (line[length] === " ") column += 1;
		else if (line[length] === "\t") column += 4 - (column % 4);
		else break;
		length += 1;
	}
	return { columns: column - initialColumn, length };
}

function indentationAcross(
	line: string,
	columns: number,
): { excess: number; length: number } | undefined {
	let current = 0;
	let length = 0;
	while (length < line.length && current < columns) {
		if (line[length] === " ") current += 1;
		else if (line[length] === "\t") current += 4 - (current % 4);
		else break;
		length += 1;
	}
	return current >= columns ? { excess: current - columns, length } : undefined;
}

function quotePrefixAfterIndent(
	line: string,
	indent: number,
): { depth: number; length: number } {
	const base = indentationAcross(line, indent);
	if (!base) return { depth: 0, length: 0 };
	const quote = quotePrefix(line.slice(base.length));
	return { depth: quote.depth, length: base.length + quote.length };
}

function structuralIndentationLength(
	line: string,
	required: number,
	optional: number,
): number | undefined {
	const prefix = indentationAcross(line, required);
	if (!prefix || prefix.excess > optional) return undefined;
	let current = required + prefix.excess;
	let length = prefix.length;
	while (length < line.length && current < required + optional) {
		const next = line[length] === " "
			? current + 1
			: line[length] === "\t" ? current + 4 - (current % 4) : current;
		if (next === current || next > required + optional) break;
		current = next;
		length += 1;
	}
	return length;
}

function leavesContainer(
	line: string,
	depth: number,
	containerIndent: number,
	quoteIndent = 0,
): boolean {
	const prefix = quotePrefixAfterIndent(line, quoteIndent);
	const content = line.slice(prefix.length);
	return prefix.depth < depth || (
		prefix.depth === depth &&
		content.trim() !== "" &&
		indentation(content).columns < containerIndent
	);
}

function appendSlice(target: SourceView, source: SourceView, from: number, to: number): void {
	if (target.rawFrom.length === 0) {
		target.rawFrom.push(source.rawFrom[from] ?? 0);
		target.rawTo.push(source.rawTo[from] ?? 0);
	} else {
		target.rawFrom[target.text.length] = source.rawFrom[from] ?? 0;
	}
	target.text += source.text.slice(from, to);
	for (let offset = from + 1; offset <= to; offset += 1) {
		target.rawFrom.push(
			source.rawFrom[offset] ?? source.rawFrom[source.rawFrom.length - 1] ?? 0,
		);
		target.rawTo.push(
			source.rawTo[offset] ?? source.rawTo[source.rawTo.length - 1] ?? 0,
		);
	}
}

function sliceView(view: SourceView, from: number, to: number): SourceView {
	return {
		text: view.text.slice(from, to),
		rawFrom: view.rawFrom.slice(from, to + 1),
		rawTo: view.rawTo.slice(from, to + 1),
	};
}

function bodyView(
	view: SourceView,
	from: number,
	to: number,
	depth: number,
	containerIndent: number,
	fenceIndent: number,
): SourceView | undefined {
	if (from === to) {
		return {
			text: "",
			rawFrom: [view.rawFrom[from] ?? 0],
			rawTo: [view.rawTo[from] ?? 0],
		};
	}
	const result: SourceView = { text: "", rawFrom: [], rawTo: [] };
	for (const line of lines(view.text, from, to)) {
		const content = view.text.slice(line.start, line.contentEnd);
		const prefix = quotePrefix(content, Number.POSITIVE_INFINITY, depth);
		if (prefix.depth < depth) return undefined;
		let prefixLength = prefix.length;
		const unquoted = content.slice(prefixLength);
		const indentationLength = structuralIndentationLength(
			unquoted,
			containerIndent,
			fenceIndent,
		);
		if (indentationLength === undefined) {
			if (unquoted.trim() !== "") return undefined;
			prefixLength += indentation(unquoted).length;
		} else {
			prefixLength += indentationLength;
		}
		appendSlice(result, view, line.start + prefixLength, line.end);
	}
	return result;
}

function htmlBlockEnd(
	source: string,
	sourceLines: SourceLine[],
	index: number,
	content: string,
	depth: number,
	containerIndent: number,
	allowCompleteTag: boolean,
): number | undefined {
	let terminator: string | undefined;
	const rawTag = /^ {0,3}<(script|pre|style|textarea)(?:[ \t>]|$)/i.exec(content)?.[1];
	if (/^ {0,3}<!--/.test(content)) terminator = "-->";
	else if (/^ {0,3}<\?/.test(content)) terminator = "?>";
	else if (/^ {0,3}<!\[CDATA\[/.test(content)) terminator = "]]>";
	else if (/^ {0,3}<![A-Z]/.test(content)) terminator = ">";
	else if (rawTag) terminator = `</${rawTag.toLowerCase()}>`;
	if (terminator) {
		for (let candidate = index; candidate < sourceLines.length; candidate += 1) {
			const line = sourceLines[candidate];
			if (!line) continue;
			const value = source.slice(line.start, line.contentEnd).toLowerCase();
			if (candidate > index && leavesContainer(value, depth, containerIndent)) {
				return candidate - 1;
			}
			if (value.includes(terminator.toLowerCase())) return candidate;
		}
		return sourceLines.length - 1;
	}
	if (
		!htmlBlockTag.test(content) &&
		!(allowCompleteTag && isCompleteHtmlTag(content))
	) return undefined;
	for (let candidate = index + 1; candidate < sourceLines.length; candidate += 1) {
		const line = sourceLines[candidate];
		if (!line) continue;
		const value = source.slice(line.start, line.contentEnd);
		const prefix = quotePrefix(value);
		if (leavesContainer(value, depth, containerIndent)) return candidate - 1;
		if (value.slice(prefix.length).trim() === "") return candidate;
	}
	return sourceLines.length - 1;
}

function directBlocks(view: SourceView): FenceBlock[] {
	const sourceLines = lines(view.text);
	const result: FenceBlock[] = [];
	const listIndents = new Map<number, number[]>();
	let paragraphContainer = "";
	let paragraphOpen = false;
	let previousParagraphLine = "";
	let commentOpen = false;
	let inlineCodeRun = 0;
	let linkReferenceLines: string[] | undefined;
	let linkReferenceCanTakeTitle = false;
	let linkReferenceTitleCloser: string | undefined;
	let mathContainer: { depth: number; indent: number } | undefined;
	for (let index = 0; index < sourceLines.length; index += 1) {
		const line = sourceLines[index];
		if (!line) continue;
		const rawContent = view.text.slice(line.start, line.contentEnd);
		if (mathContainer) {
			const mathQuote = quotePrefix(rawContent, 3, mathContainer.depth);
			const mathUnquoted = rawContent.slice(mathQuote.length);
			const mathIndent = indentationAcross(mathUnquoted, mathContainer.indent);
			if (
				mathQuote.depth === mathContainer.depth &&
				(mathUnquoted.trim() === "" || mathIndent)
			) {
				if (mathIndent && displayMathFence.test(
					" ".repeat(mathIndent.excess) + mathUnquoted.slice(mathIndent.length),
				)) mathContainer = undefined;
				continue;
			}
			mathContainer = undefined;
		}
		const prefix = quotePrefix(rawContent);
		for (const depth of listIndents.keys()) {
			if (depth > prefix.depth) listIndents.delete(depth);
		}
		const unquoted = rawContent.slice(prefix.length);
		const indents = listIndents.get(prefix.depth) ?? [];
		let markerMatch = thematicBreak.test(unquoted) ? null : listMarker.exec(unquoted);
		const footnoteMatch = markerMatch ? null : footnoteMarker.exec(unquoted);
		let containerIndent = 0;
		let containerLength = 0;
		let virtualIndent = 0;
		if (markerMatch) {
			const markerIndent = markerMatch[1]!.length;
			while ((indents[indents.length - 1] ?? -1) > markerIndent) indents.pop();
			const sameParagraph = paragraphOpen && paragraphContainer ===
				`${prefix.depth}:${indents[indents.length - 1] ?? 0}`;
			if (sameParagraph && !listMarkerInterruptsParagraph(unquoted, markerMatch)) {
				markerMatch = null;
			}
		}
		if (markerMatch) {
			const item = listItemPrefix(markerMatch);
			containerLength = item.length;
			containerIndent = item.indent;
			if (indents[indents.length - 1] !== containerIndent) indents.push(containerIndent);
			listIndents.set(prefix.depth, indents);
		} else if (footnoteMatch) {
			const markerIndent = footnoteMatch[1]!.length;
			while ((indents[indents.length - 1] ?? -1) > markerIndent) indents.pop();
			containerLength = footnoteMatch[0].length;
			containerIndent = markerIndent + 4;
			if (indents[indents.length - 1] !== containerIndent) indents.push(containerIndent);
			listIndents.set(prefix.depth, indents);
		} else {
			const blank = unquoted.trim() === "";
			const leading = indentation(unquoted).columns;
			if (!blank) {
				while ((indents[indents.length - 1] ?? -1) > leading) indents.pop();
			}
			containerIndent = indents[indents.length - 1] ?? 0;
			const prefix = blank
				? { excess: 0, length: indentation(unquoted).length }
				: indentationAcross(unquoted, containerIndent);
			if (!prefix) continue;
			containerLength = prefix.length;
			virtualIndent = prefix.excess;
		}
		let depth = prefix.depth;
		let quoteIndent = 0;
		let insertionPrefix = rawContent.slice(0, prefix.length) + " ".repeat(containerIndent);
		let content = " ".repeat(virtualIndent) + unquoted.slice(containerLength);
		let hadMarker = markerMatch !== null || footnoteMatch !== null;
		let allowNestedList = hadMarker || containerLength > 0;
		let nestedMustInterruptParagraph = paragraphOpen && !hadMarker;
		while (true) {
			const nestedQuote = quotePrefix(content);
			if (nestedQuote.depth > 0) {
				if (prefix.depth === 0 && depth === 0) quoteIndent = containerIndent;
				depth += nestedQuote.depth;
				insertionPrefix += content.slice(0, nestedQuote.length);
				content = content.slice(nestedQuote.length);
				containerIndent = 0;
				allowNestedList = true;
				nestedMustInterruptParagraph = false;
				continue;
			}
			if (!allowNestedList) break;
			const nestedMarker = thematicBreak.test(content) ? null : listMarker.exec(content);
			if (!nestedMarker || (nestedMustInterruptParagraph &&
				!listMarkerInterruptsParagraph(content, nestedMarker))) break;
			const item = listItemPrefix(nestedMarker);
			containerIndent += item.indent;
			insertionPrefix += " ".repeat(item.indent);
			content = content.slice(item.length);
			hadMarker = true;
			nestedMustInterruptParagraph = false;
			const nestedIndents = listIndents.get(depth) ?? [];
			if (nestedIndents[nestedIndents.length - 1] !== containerIndent) {
				nestedIndents.push(containerIndent);
			}
			listIndents.set(depth, nestedIndents);
		}
		const container = `${depth}:${containerIndent}`;
		const paragraphInterrupted = interruptsParagraph(content, previousParagraphLine);
		const [paragraphDepth, paragraphIndent] = paragraphContainer.split(":").map(Number);
		const lazyContinuation = paragraphOpen && !hadMarker && content.trim() !== "" &&
			container !== paragraphContainer &&
			(depth < paragraphDepth! ||
				(depth === paragraphDepth && containerIndent < paragraphIndent!)) &&
			!paragraphInterrupted;
		if (hadMarker || (container !== paragraphContainer && !lazyContinuation)) {
			paragraphOpen = false;
			previousParagraphLine = "";
			linkReferenceLines = undefined;
			linkReferenceCanTakeTitle = false;
			linkReferenceTitleCloser = undefined;
			inlineCodeRun = 0;
		}
		paragraphContainer = container;
		if (content.trim() === "") {
			paragraphOpen = false;
			previousParagraphLine = "";
			linkReferenceLines = undefined;
			linkReferenceCanTakeTitle = false;
			linkReferenceTitleCloser = undefined;
			inlineCodeRun = 0;
			continue;
		}
		if (!commentOpen && inlineCodeRun === 0 && displayMathFence.test(content)) {
			mathContainer = { depth, indent: containerIndent };
			paragraphOpen = false;
			previousParagraphLine = "";
			linkReferenceLines = undefined;
			linkReferenceCanTakeTitle = false;
			linkReferenceTitleCloser = undefined;
			continue;
		}
		if (linkReferenceTitleCloser) {
			if (paragraphInterrupted) {
				linkReferenceTitleCloser = undefined;
				paragraphOpen = true;
			} else {
				const status = continuedTitleStatus(content, linkReferenceTitleCloser);
				if (status === "possible") continue;
				linkReferenceTitleCloser = undefined;
				if (status === "complete") continue;
				paragraphOpen = true;
				previousParagraphLine = content;
				continue;
			}
		}
		if (
			!commentOpen &&
			!paragraphOpen &&
			/^(?: {4}|\t)/.test(content) &&
			(!linkReferenceLines || linkReferenceCanTakeTitle)
		) {
			previousParagraphLine = "";
			linkReferenceLines = undefined;
			linkReferenceCanTakeTitle = false;
			linkReferenceTitleCloser = undefined;
			inlineCodeRun = 0;
			continue;
		}
		if (inlineCodeRun > 0 && paragraphInterrupted) inlineCodeRun = 0;
		if (linkReferenceLines && !linkReferenceCanTakeTitle && paragraphInterrupted) {
			linkReferenceLines = undefined;
			paragraphOpen = true;
		}
		let commentTouched = false;
		if (commentOpen || inlineCodeRun > 0) {
			const comment = stripObsidianComments(
				content,
				commentOpen,
				inlineCodeRun,
				view.text,
				line.end,
			);
			content = comment.text;
			commentOpen = comment.open;
			inlineCodeRun = comment.codeRun;
			commentTouched = true;
		}
		if (!commentTouched && !paragraphOpen) {
			if (linkReferenceCanTakeTitle) {
				if (/^ {0,3}["'(]/.test(content)) linkReferenceCanTakeTitle = false;
				else {
					linkReferenceLines = undefined;
					linkReferenceCanTakeTitle = false;
				}
			}
			if (linkReferenceLines) {
				linkReferenceLines.push(content);
				const status = linkReferenceStatus(linkReferenceLines);
				const closer = titleCloser(status);
				if (closer) {
					linkReferenceLines = undefined;
					linkReferenceCanTakeTitle = false;
					linkReferenceTitleCloser = closer;
					continue;
				}
				if (status === "possible") continue;
				if (status === "destination") {
					linkReferenceCanTakeTitle = true;
					continue;
				}
				linkReferenceLines = undefined;
				linkReferenceCanTakeTitle = false;
				if (status === "complete") continue;
				paragraphOpen = true;
			}
			if (!paragraphOpen && /^ {0,3}\[/.test(content)) {
				const status = linkReferenceStatus([content]);
				const closer = titleCloser(status);
				if (closer) {
					linkReferenceTitleCloser = closer;
					continue;
				}
				if (status === "possible") {
					linkReferenceLines = [content];
					continue;
				}
				if (status === "destination") {
					linkReferenceLines = [content];
					linkReferenceCanTakeTitle = true;
					continue;
				}
				if (status === "complete") continue;
			}
		}
		if (!commentTouched) {
			const htmlEnd = htmlBlockEnd(
				view.text,
				sourceLines,
				index,
				content,
				depth,
				containerIndent,
				!paragraphOpen,
			);
			if (htmlEnd !== undefined) {
				index = htmlEnd;
				paragraphOpen = false;
				previousParagraphLine = "";
				continue;
			}
		}
		const match = commentTouched ? undefined : parseFenceLine(content);
		if (!match) {
			if (!commentTouched) {
				const comment = stripObsidianComments(
					content,
					false,
					inlineCodeRun,
					view.text,
					line.end,
				);
				content = comment.text;
				commentOpen = comment.open;
				inlineCodeRun = comment.codeRun;
				commentTouched = comment.touched;
			}
			if (commentTouched && content.trim() === "") continue;
				const singleLineBlock: boolean = atxHeading.test(content) ||
				thematicBreak.test(content) ||
				(!paragraphOpen && /^(?: {4}|\t)/.test(content)) ||
				(paragraphOpen && (
					setextHeading.test(content) ||
					(
						previousParagraphLine.includes("|") &&
						content.includes("|") &&
						tableDelimiter.test(content) &&
						tableColumnCount(previousParagraphLine) === tableColumnCount(content)
					)
				));
			paragraphOpen = !singleLineBlock;
			if (singleLineBlock) inlineCodeRun = 0;
			previousParagraphLine = paragraphOpen ? content : "";
			continue;
		}
		const fence = match.run;
		const marker = fence[0]!;
		const info = match.info;

		let closeIndex = -1;
		let containerEndIndex = sourceLines.length;
		for (let candidate = index + 1; candidate < sourceLines.length; candidate += 1) {
			const close = sourceLines[candidate];
			if (!close) continue;
			const closeContent = view.text.slice(close.start, close.contentEnd);
			const closePrefix = quotePrefixAfterIndent(closeContent, quoteIndent);
			if (leavesContainer(
				closeContent,
				depth,
				containerIndent,
				quoteIndent,
			)) {
				containerEndIndex = candidate;
				break;
			}
			if (closePrefix.depth !== depth) continue;
			const continuation = closeContent.slice(closePrefix.length);
			const continuationPrefix = indentationAcross(continuation, containerIndent);
			if (!continuationPrefix) continue;
			const closeMatch = parseFenceLine(
				" ".repeat(continuationPrefix.excess) +
				continuation.slice(continuationPrefix.length),
			);
			if (
				closeMatch?.run[0] === marker &&
				closeMatch.run.length >= fence.length &&
				/^[ \t]*$/.test(closeMatch.info)
			) {
				closeIndex = candidate;
				break;
			}
		}
		const close = closeIndex < 0 ? undefined : sourceLines[closeIndex];
		const innerEnd = close?.start ?? sourceLines[containerEndIndex]?.start ?? view.text.length;
		if (!close && !isTabsdownFence(info)) {
			if (containerEndIndex >= sourceLines.length) break;
			index = containerEndIndex - 1;
			paragraphOpen = false;
			continue;
		}
		const inner = bodyView(
			view,
			line.end,
			innerEnd,
			depth,
			containerIndent,
			match.indent,
		);
		if (inner && isTabsdownFence(info)) {
			result.push({
				open: line.start,
				inner,
				innerRawFrom: view.rawTo[line.end] ?? -1,
				innerRawTo: view.rawTo[innerEnd] ?? -1,
				closeEnd: close?.end ?? innerEnd,
				prefix: insertionPrefix + " ".repeat(match.indent),
				innerHasLine: line.end < innerEnd,
			});
		}
		if (closeIndex >= 0) index = closeIndex;
		else if (containerEndIndex < sourceLines.length) index = containerEndIndex - 1;
		else break;
		paragraphOpen = false;
		previousParagraphLine = "";
		linkReferenceLines = undefined;
		linkReferenceCanTakeTitle = false;
		linkReferenceTitleCloser = undefined;
		inlineCodeRun = 0;
	}
	return result;
}

function lineOffset(source: string, line: number): number {
	let offset = 0;
	for (let index = 0; index < line; index += 1) {
		const newline = source.indexOf("\n", offset);
		if (newline < 0) return -1;
		offset = newline + 1;
	}
	return offset;
}

function tabBodies(source: string): SourceRange[] {
	const bodies: SourceRange[] = [];
	let bodyStart: number | undefined;
	let openFence: string | undefined;
	let nested = false;
	for (const line of lines(source)) {
		const content = source.slice(line.start, line.contentEnd);
		const fence = parseFenceLine(content);
		if (openFence) {
			if (fence?.run.startsWith(openFence) && /^[ \t]*$/.test(fence.info)) {
				openFence = undefined;
				nested = false;
			}
		} else if (fence) {
			openFence = fence.run;
			nested = isTabsdownFence(fence.info);
		}
		if (!nested && content.startsWith("tab:")) {
			if (bodyStart !== undefined) bodies.push({ from: bodyStart, to: line.start });
			bodyStart = line.end;
			openFence = undefined;
		}
	}
	if (bodyStart !== undefined) bodies.push({ from: bodyStart, to: source.length });
	return bodies;
}

function nestedBlockAt(view: SourceView, offset: number): FenceBlock | undefined {
	for (const body of tabBodies(view.text)) {
		if (offset < body.from || offset >= body.to) continue;
		return directBlocks(sliceView(view, body.from, body.to)).find(
			(candidate) => candidate.open === offset - body.from,
		);
	}
	return undefined;
}

function resolveLocator(source: string, locator: BlockLocator): FenceBlock {
	const view = createSourceView(source);
	const opening = lineOffset(view.text, locator.lineStart);
	const scanFrom = frontmatterEnd(view.text);
	const found = directBlocks(sliceView(view, scanFrom, view.text.length)).find(
		(candidate) => candidate.open === opening - scanFrom,
	);
	if (!found) throw new SourceConflictError("The Tabsdown block could not be located.");
	let block = found;
	for (const relativeOffset of locator.nestedOffsets) {
		const nested = nestedBlockAt(block.inner, relativeOffset);
		if (!nested) throw new SourceConflictError("The nested Tabsdown block could not be located.");
		block = nested;
	}
	return block;
}

export function renderedSourceKey(source: string): string {
	return source.endsWith("\n") ? source.slice(0, -1) : source;
}

function matchesRenderedSource(authored: string, rendered: string): boolean {
	return renderedSourceKey(authored) === renderedSourceKey(rendered);
}

export function captureBlock(
	text: string,
	locator: BlockLocator,
	renderedSource: string,
): BlockSnapshot {
	const block = resolveLocator(text, locator);
	if (!block || !matchesRenderedSource(block.inner.text, renderedSource)) {
		throw new SourceConflictError("The Tabsdown block changed. Reopen its settings.");
	}
	const target = block.inner.text;
	return {
		locator,
		text,
		target,
		rawTarget: text.slice(block.innerRawFrom, block.innerRawTo),
	};
}

export function rewriteBlock(
	text: string,
	snapshot: BlockSnapshot,
	config: TabsdownConfig,
): SourceEdit {
	if (text !== snapshot.text) {
		throw new SourceConflictError("The note changed. Reopen the block settings.");
	}
	const block = resolveLocator(text, snapshot.locator);
	if (
		!block ||
		block.inner.text !== snapshot.target ||
		text.slice(block.innerRawFrom, block.innerRawTo) !== snapshot.rawTarget
	) {
		throw new SourceConflictError("The Tabsdown block changed. Reopen its settings.");
	}
	const edit = configEdit(snapshot.target, config);
	const logicalNewline = block.inner.text.indexOf("\n");
	const rawNewline = logicalNewline < 0
		? "\n"
		: text.slice(
			block.inner.rawFrom[logicalNewline],
			block.inner.rawTo[logicalNewline + 1],
		);
	let replacement = edit.replacement.replace(/\r?\n/g, rawNewline);
	let from = block.inner.rawFrom[edit.from] ?? -1;
	if (replacement === "" && edit.from < edit.to) {
		from = text.lastIndexOf("\n", from - 1) + 1;
	}
	if (edit.from === edit.to && block.prefix) {
		const rawInsertion = block.inner.rawFrom[edit.from] ?? -1;
		const lineStart = text.lastIndexOf("\n", rawInsertion - 1) + 1;
		const continuation = text.slice(lineStart, rawInsertion);
		replacement = block.innerHasLine
			? replacement.replace(/\r?\n/g, (newline) => `${newline}${continuation}`)
			: `${block.prefix}${replacement}`;
	}
	return {
		from,
		to: block.inner.rawTo[edit.to] ?? -1,
		replacement,
	};
}

export function applySourceEdit(text: string, edit: SourceEdit): string {
	return text.slice(0, edit.from) + edit.replacement + text.slice(edit.to);
}

export function nestedBlockCandidates(
	source: string,
	tabIndex: number,
): Array<{ offset: number; source: string }> {
	const body = tabBodies(source)[tabIndex];
	if (!body) return [];
	const view = createSourceView(source.slice(body.from, body.to), body.from);
	return directBlocks(view).map((block) => ({
		offset: view.rawFrom[block.open] ?? -1,
		source: block.inner.text,
	}));
}
