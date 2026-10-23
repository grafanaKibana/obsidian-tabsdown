export const htmlBlockTag = /^(?: {0,3})<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t/>]|$)/i;
const htmlTagName = /[A-Za-z][A-Za-z0-9-]*/y;
const htmlAttribute = /[ \t]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \t]*=[ \t]*(?:[^ "'=<>`]+|'[^']*'|"[^"]*"))?/y;
const htmlClosingTagTail = /[ \t]*>[ \t]*$/y;
const htmlTagClose = /[ \t]*\/?>[ \t]*$/y;

export function isCompleteHtmlTag(line: string): boolean {
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

/** Authored Tabsdown delimiters. Offsets always address the supplied string. */
export type TabsSyntax = "fenced" | "markers";
export interface CommentMarker {
	kind: "tabs" | "endtabs" | "tab" | "config";
	value: string;
	from: number;
	to: number;
	end: number;
	valueFrom: number;
	valueTo: number;
}

export function commentMarker(line: string): Omit<CommentMarker, "from" | "to" | "end"> | undefined {
	const match = /^ {0,3}%%[ \t]*(tabs|endtabs|tab:|config:)(.*?)[ \t]*%%[ \t]*$/.exec(line);
	if (!match) return undefined;
	const name = match[1]!;
	const tail = match[2]!;
	if ((name === "tabs" || name === "endtabs") && tail.trim() !== "") return undefined;
	const value = tail.trim();
	const start = line.indexOf(name) + name.length;
	const valueFrom = start + tail.length - tail.trimStart().length;
	return {
		kind: name === "tab:" ? "tab" : name === "config:" ? "config" : name as "tabs" | "endtabs",
		value, valueFrom, valueTo: valueFrom + value.length,
	};
}

function tableColumnCount(line: string): number {
	let pipes = 0;
	let first = -1;
	let last = -1;
	for (let index = 0; index < line.length; index += 1) {
		if (line[index] !== "|") continue;
		let slashes = 0;
		for (let cursor = index - 1; cursor >= 0 && line[cursor] === "\\"; cursor -= 1) slashes += 1;
		if (slashes % 2 === 1) continue;
		if (first < 0) first = index;
		last = index;
		pipes += 1;
	}
	return pipes + 1 - Number(first >= 0 && first === line.search(/\S/)) -
		Number(last >= 0 && last === line.search(/\s*$/) - 1);
}

function interruptsCodeParagraph(line: string, previousLine: string): boolean {
	const list = /^ {0,3}([-+*]|\d{1,9}[.)])[ \t]+(\S.*)$/.exec(line);
	return /^ {0,3}(?:`{3,}[^`]*|~{3,}.*)$/.test(line) ||
		/^ {0,3}(?:#{1,6}(?:[ \t]|$)|>|<!--|<\?|<!\[CDATA\[|<![A-Z]|<(?:script|pre|style|textarea)(?:[ \t>]|$))/i.test(line) ||
		/^ {0,3}(?:(?:=+|-+)[ \t]*|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,}|\$\$[ \t]*)$/.test(line) ||
		htmlBlockTag.test(line) ||
		Boolean(list && (!/^\d/.test(list[1]!) || Number.parseInt(list[1]!, 10) === 1)) ||
		(previousLine.includes("|") && line.includes("|") &&
			/^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/.test(line) &&
			tableColumnCount(line) === tableColumnCount(previousLine));
}

function endsCodeParagraph(line: string): boolean {
	return !line.trim() || /^ {0,3}#{1,6}(?:[ \t]|$)/.test(line) ||
		/^ {0,3}(?:(?:=+|-+)[ \t]*|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,})$/.test(line);
}

function hasClosingCodeRun(source: string, from: number, length: number, previousLine: string): boolean {
	let first = true;
	for (const line of source.slice(from).split(/\r?\n/)) {
		if (!first && (!line.trim() || interruptsCodeParagraph(line, previousLine))) return false;
		for (const match of line.matchAll(/`+/g)) {
			if (match[0].length === length) return true;
		}
		if (first && endsCodeParagraph(previousLine)) return false;
		previousLine = first ? previousLine : line;
		first = false;
	}
	return false;
}

interface ContainerStep { quote?: true; indent?: number }

function indentColumns(text: string): number {
	let columns = 0;
	for (const character of text) columns += character === "\t" ? 4 - columns % 4 : 1;
	return columns;
}

/** Projects only containers whose first content is a nested Tabsdown opener. */
function containedLayout(source: string, from: number, end: number, line: string): { markers: CommentMarker[]; end: number } | undefined {
	const steps: ContainerStep[] = [];
	let content = line;
	while (commentMarker(content)?.kind !== "tabs") {
		const quote = /^ {0,3}>[ \t]?/.exec(content)?.[0];
		const list = /^( {0,3}(?:[-+*]|\d{1,9}[.)]))([ \t]+)/.exec(content);
		const listPrefix = list && indentColumns(list[0]) - indentColumns(list[1]!) <= 4 ? list[0] : undefined;
		const prefix = quote ?? listPrefix;
		if (!prefix) return undefined;
		steps.push(quote ? { quote: true } : { indent: indentColumns(prefix) });
		content = content.slice(prefix.length);
	}
	if (!steps.length) return undefined;
	const rows = [{ text: content, from, end, offset: line.length - content.length, projected: 0 }];
	for (const match of source.slice(end).matchAll(/[^\n]*(?:\n|$)/g)) {
		if (!match[0]) continue;
		const raw = match[0].replace(/\r?\n$/, "");
		let remaining = raw;
		let offset = 0;
		let valid = true;
		for (const step of steps) {
			if (step.quote) {
				const prefix = /^ {0,3}>[ \t]?/.exec(remaining)?.[0];
				if (!prefix) { valid = false; break; }
				remaining = remaining.slice(prefix.length);
				offset += prefix.length;
			} else if (remaining.trim()) {
				const whitespace = /^[ \t]*/.exec(remaining)![0];
				let consumed = 0;
				while (consumed < whitespace.length && indentColumns(whitespace.slice(0, consumed)) < step.indent!) consumed += 1;
				const columns = indentColumns(whitespace.slice(0, consumed));
				if (columns < step.indent!) { valid = false; break; }
				const padding = columns - step.indent!;
				remaining = " ".repeat(padding) + remaining.slice(consumed);
				offset += consumed - padding;
			}
		}
		if (!valid) break;
		const rowFrom = end + match.index;
		rows.push({ text: remaining, from: rowFrom, end: rowFrom + match[0].length, offset, projected: 0 });
	}
	let projected = "";
	for (const row of rows) { row.projected = projected.length; projected += row.text + "\n"; }
	let depth = 0;
	const markers: CommentMarker[] = [];
	for (const marker of commentMarkers(projected)) {
		let rowIndex = rows.length - 1;
		while (rows[rowIndex]!.projected > marker.from) rowIndex -= 1;
		const row = rows[rowIndex]!;
		const map = (offset: number) => row.from + row.offset + offset - row.projected;
		markers.push({ ...marker, from: row.from, to: map(marker.to), end: row.end,
			valueFrom: map(marker.valueFrom), valueTo: map(marker.valueTo) });
		if (marker.kind === "tabs") depth += 1;
		if (marker.kind === "endtabs" && --depth === 0) break;
	}
	return { markers, end: rows[rows.length - 1]!.end };
}

/** Finds control comments outside Markdown literal contexts. */
export function commentMarkers(source: string): CommentMarker[] {
	const result: CommentMarker[] = [];
	let fence: string | undefined;
	let html: string | undefined;
	let htmlBlank = false;
	let comment = false;
	let math = false;
	let code = 0;
	let paragraph = false;
	let previousLine = "";
	let containerEnd = 0;
	for (const match of source.matchAll(/[^\n]*(?:\n|$)/g)) {
		if (!match[0]) continue;
		const from = match.index;
		if (from < containerEnd) continue;
		const line = match[0].replace(/\r?\n$/, "");
		const fenceMatch = /^ {0,3}(`{3,})([^`]*)$/.exec(line) ?? /^ {0,3}(~{3,})(.*)$/.exec(line);
		if (fence) {
			if (fenceMatch?.[1]?.startsWith(fence) && !fenceMatch[2]?.trim()) fence = undefined;
			paragraph = false;
			continue;
		}
		if (html) { if (line.toLowerCase().includes(html)) html = undefined; paragraph = false; continue; }
		if (htmlBlank) { if (!line.trim()) htmlBlank = false; paragraph = false; continue; }
		if (math) { if (/^ {0,3}\$\$[ \t]*$/.test(line)) math = false; continue; }
		if (code && interruptsCodeParagraph(line, previousLine)) code = 0;
		if (!comment && !code) {
			if (fenceMatch) { fence = fenceMatch[1]; continue; }
			if (!paragraph && /^(?: {4}|\t)/.test(line)) continue;
			const contained = containedLayout(source, from, from + match[0].length, line);
			if (contained) {
				result.push(...contained.markers);
				containerEnd = contained.end;
				paragraph = false;
				continue;
			}
			const marker = commentMarker(line);
			if (marker) {
				result.push({ ...marker, from, to: from + line.length, end: from + match[0].length,
					valueFrom: from + marker.valueFrom, valueTo: from + marker.valueTo });
				paragraph = false;
				continue;
			}
			if (/^ {0,3}\$\$[ \t]*$/.test(line)) { math = true; continue; }
			let terminator: string | undefined;
			if (/^ {0,3}<!--/.test(line)) terminator = "-->";
			else if (/^ {0,3}<\?/.test(line)) terminator = "?>";
			else if (/^ {0,3}<!\[CDATA\[/.test(line)) terminator = "]]>";
			else if (/^ {0,3}<![A-Z]/.test(line)) terminator = ">";
			else {
				const tag = /^ {0,3}<(script|pre|style|textarea)(?:[ \t>]|$)/i.exec(line)?.[1];
				if (tag) terminator = `</${tag.toLowerCase()}>`;
			}
			if (terminator) { if (!line.toLowerCase().includes(terminator)) html = terminator; continue; }
			if (htmlBlockTag.test(line) || (!paragraph && isCompleteHtmlTag(line))) { htmlBlank = true; paragraph = false; continue; }
		}
		for (let cursor = 0; cursor < line.length;) {
			if (comment) { const end = line.indexOf("%%", cursor); if (end < 0) break; comment = false; cursor = end + 2; }
			else if (!code && line.startsWith("<!--", cursor)) {
				const end = line.indexOf("-->", cursor + 4);
				if (end < 0) { html = "-->"; break; }
				cursor = end + 3;
			}
			else if (line[cursor] === "`" && (code > 0 || cursor === 0 || line[cursor - 1] !== "\\")) {
				let end = cursor + 1; while (line[end] === "`") end += 1;
				const length = end - cursor;
				if (code === length) code = 0;
				else if (!code && hasClosingCodeRun(source, from + end, length, line)) code = length;
				cursor = end;
			} else if (!code && line.startsWith("%%", cursor)) { comment = true; cursor += 2; }
			else cursor += 1;
		}
		paragraph = !endsCodeParagraph(line);
		if (!paragraph) code = 0;
		previousLine = line;
	}
	return result;
}
