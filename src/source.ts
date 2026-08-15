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
const htmlBlockTag = /^(?: {0,3})<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t/>]|$)/i;
const htmlCompleteTag = /^ {0,3}(?:<\/[A-Za-z][A-Za-z0-9-]*[ \t]*>|<[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \t]*=[ \t]*(?:[^ "'=<>`]+|'[^']*'|"[^"]*"))?)*[ \t]*\/?>)[ \t]*$/;
const atxHeading = /^ {0,3}#{1,6}(?:[ \t]+|$)/;
const setextHeading = /^ {0,3}(?:=+|-+)[ \t]*$/;
const thematicBreak = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,})$/;

export class SourceConflictError extends Error {}

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

function quotePrefix(line: string): { depth: number; length: number } {
	let depth = 0;
	let offset = 0;
	while (offset < line.length) {
		let marker = offset;
		while (marker < line.length && marker - offset < 3 && line[marker] === " ") marker += 1;
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

function leavesContainer(line: string, depth: number, containerIndent: number): boolean {
	const prefix = quotePrefix(line);
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
		const prefix = quotePrefix(content);
		if (prefix.depth < depth) return undefined;
		let prefixLength = 0;
		for (let count = 0; count < depth; count += 1) {
			let marker = prefixLength;
			while (marker < content.length && marker - prefixLength < 3 && content[marker] === " ") marker += 1;
			prefixLength = marker + 1;
			if (content[prefixLength] === " " || content[prefixLength] === "\t") prefixLength += 1;
		}
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
	else if (rawTag) terminator = `</${rawTag.toLowerCase()}`;
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
		!(allowCompleteTag && htmlCompleteTag.test(content))
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
	for (let index = 0; index < sourceLines.length; index += 1) {
		const line = sourceLines[index];
		if (!line) continue;
		const rawContent = view.text.slice(line.start, line.contentEnd);
		const prefix = quotePrefix(rawContent);
		for (const depth of listIndents.keys()) {
			if (depth > prefix.depth) listIndents.delete(depth);
		}
		const unquoted = rawContent.slice(prefix.length);
		const indents = listIndents.get(prefix.depth) ?? [];
		const markerMatch = listMarker.exec(unquoted);
		let containerIndent = 0;
		let containerLength = 0;
		let virtualIndent = 0;
		if (markerMatch) {
			const markerIndent = markerMatch[1]!.length;
			while ((indents[indents.length - 1] ?? -1) > markerIndent) indents.pop();
			const markerEndLength = markerMatch[0].length - markerMatch[3]!.length;
			const markerEndColumn = markerIndent + markerMatch[2]!.length;
			const padding = indentation(markerMatch[3]!, markerEndColumn);
			const paddingLength = padding.columns > 4 ? 1 : padding.length;
			containerLength = markerEndLength + paddingLength;
			containerIndent = markerEndColumn + indentation(
				markerMatch[3]!.slice(0, paddingLength),
				markerEndColumn,
			).columns;
			if (indents[indents.length - 1] !== containerIndent) indents.push(containerIndent);
			listIndents.set(prefix.depth, indents);
		} else {
			const leading = indentation(unquoted).columns;
			while ((indents[indents.length - 1] ?? -1) > leading) indents.pop();
			containerIndent = indents[indents.length - 1] ?? 0;
			const prefix = indentationAcross(unquoted, containerIndent);
			if (!prefix) continue;
			containerLength = prefix.length;
			virtualIndent = prefix.excess;
		}
		const container = `${prefix.depth}:${containerIndent}`;
		if (markerMatch || container !== paragraphContainer) paragraphOpen = false;
		paragraphContainer = container;
		const content = " ".repeat(virtualIndent) + unquoted.slice(containerLength);
		if (content.trim() === "") {
			paragraphOpen = false;
			continue;
		}
		const htmlEnd = htmlBlockEnd(
			view.text,
			sourceLines,
			index,
			content,
			prefix.depth,
			containerIndent,
			!paragraphOpen,
		);
		if (htmlEnd !== undefined) {
			index = htmlEnd;
			paragraphOpen = false;
			continue;
		}
		const match = parseFenceLine(content);
		if (!match) {
			if (paragraphOpen) {
				if (setextHeading.test(content)) paragraphOpen = false;
			} else {
				paragraphOpen = !(
					atxHeading.test(content) ||
					thematicBreak.test(content) ||
					/^(?: {4}|\t)/.test(content)
				);
			}
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
			const closePrefix = quotePrefix(closeContent);
			if (leavesContainer(closeContent, prefix.depth, containerIndent)) {
				containerEndIndex = candidate;
				break;
			}
			if (closePrefix.depth !== prefix.depth) continue;
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
			prefix.depth,
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
				prefix: rawContent.slice(0, prefix.length) + " ".repeat(
					containerIndent + match.indent,
				),
				innerHasLine: line.end < innerEnd,
			});
		}
		if (closeIndex >= 0) index = closeIndex;
		else if (containerEndIndex < sourceLines.length) index = containerEndIndex - 1;
		else break;
		paragraphOpen = false;
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
	const found = directBlocks(view).find((candidate) => candidate.open === opening);
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
