import { configEdit, isValidBlockId, type TabsdownConfig } from "./config";
import { isTabsdownFence, parseFenceLine } from "./parser";

export interface BlockLocator {
	lineStart: number;
	nestedOffsets: number[];
}

export interface BlockSnapshot {
	locator: BlockLocator;
	text?: string;
	target: string;
	rawTarget: string;
	blockId?: string;
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
	indentation: number,
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
		let removed = 0;
		while (removed < indentation && content[prefixLength + removed] === " ") removed += 1;
		prefixLength += removed;
		appendSlice(result, view, line.start + prefixLength, line.end);
	}
	return result;
}

function directBlocks(view: SourceView): FenceBlock[] {
	const sourceLines = lines(view.text);
	const result: FenceBlock[] = [];
	for (let index = 0; index < sourceLines.length; index += 1) {
		const line = sourceLines[index];
		if (!line) continue;
		const rawContent = view.text.slice(line.start, line.contentEnd);
		const prefix = quotePrefix(rawContent);
		const match = parseFenceLine(rawContent.slice(prefix.length));
		if (!match) continue;
		const fence = match.run;
		const marker = fence[0]!;
		const info = match.info;

		let closeIndex = -1;
		for (let candidate = index + 1; candidate < sourceLines.length; candidate += 1) {
			const close = sourceLines[candidate];
			if (!close) continue;
			const closeContent = view.text.slice(close.start, close.contentEnd);
			const closePrefix = quotePrefix(closeContent);
			if (closePrefix.depth !== prefix.depth) continue;
			const closeMatch = parseFenceLine(closeContent.slice(closePrefix.length));
			if (
				closeMatch?.run[0] === marker &&
				closeMatch.run.length >= fence.length &&
				/^[ \t]*$/.test(closeMatch.info)
			) {
				closeIndex = candidate;
				break;
			}
		}
		if (closeIndex < 0) continue;
		const close = sourceLines[closeIndex];
		if (!close) continue;
		const inner = bodyView(view, line.end, close.start, prefix.depth, match.indent);
		if (inner && isTabsdownFence(info)) {
			result.push({
				open: line.start,
				inner,
				innerRawFrom: view.rawTo[line.end] ?? -1,
				innerRawTo: view.rawTo[close.start] ?? -1,
				closeEnd: close.end,
				prefix: rawContent.slice(0, prefix.length + match.indent),
				innerHasLine: line.end < close.start,
			});
		}
		index = closeIndex;
	}
	return result;
}

function allBlocks(view: SourceView): FenceBlock[] {
	const result: FenceBlock[] = [];
	for (const block of directBlocks(view)) {
		result.push(block, ...allBlocks(block.inner));
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

function idBlocks(source: string, blockId: string): FenceBlock[] {
	return allBlocks(createSourceView(source)).flatMap((block) => {
		let matches = 0;
		for (const line of block.inner.text.split(/\r?\n/)) {
			if (line.trim() === "") continue;
			if (!line.startsWith("config:")) break;
			for (const token of line.slice("config:".length).split(",")) {
				const trimmedToken = token.trim();
				const value = trimmedToken.slice("block-id=".length);
				if (trimmedToken.startsWith("block-id=") && value === blockId && isValidBlockId(value)) {
					matches += 1;
				}
			}
		}
		return Array.from({ length: matches }, () => block);
	});
}

function matchesRenderedSource(authored: string, rendered: string): boolean {
	return authored === rendered || (
		authored.endsWith("\n") && authored.slice(0, -1) === rendered
	);
}

export function captureBlock(
	text: string,
	locator: BlockLocator,
	renderedSource: string,
	blockId?: string,
): BlockSnapshot {
	const matches = blockId ? idBlocks(text, blockId) : [resolveLocator(text, locator)];
	if (matches.length !== 1) {
		throw new SourceConflictError("The Tabsdown block identity is missing or duplicated.");
	}
	const block = matches[0];
	if (!block || !matchesRenderedSource(block.inner.text, renderedSource)) {
		throw new SourceConflictError("The Tabsdown block changed. Reopen its settings.");
	}
	const target = block.inner.text;
	return {
		locator,
		...(blockId ? {} : { text }),
		target,
		rawTarget: text.slice(block.innerRawFrom, block.innerRawTo),
		...(blockId ? { blockId } : {}),
	};
}

export function rewriteBlock(
	text: string,
	snapshot: BlockSnapshot,
	config: TabsdownConfig & { blockId: string },
): SourceEdit {
	if (!snapshot.blockId && text !== snapshot.text) {
		throw new SourceConflictError("The note changed. Reopen the block settings.");
	}
	const matches = snapshot.blockId
		? idBlocks(text, snapshot.blockId)
		: [resolveLocator(text, snapshot.locator)];
	if (matches.length !== 1) {
		throw new SourceConflictError("The Tabsdown block identity is missing or duplicated.");
	}
	const block = matches[0];
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
	if (edit.from === edit.to && block.prefix) {
		const rawInsertion = block.inner.rawFrom[edit.from] ?? -1;
		const lineStart = text.lastIndexOf("\n", rawInsertion - 1) + 1;
		const continuation = text.slice(lineStart, rawInsertion);
		replacement = block.innerHasLine
			? replacement.replace(/\r?\n/g, (newline) => `${newline}${continuation}`)
			: `${block.prefix}${replacement}`;
	}
	return {
		from: block.inner.rawFrom[edit.from] ?? -1,
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
