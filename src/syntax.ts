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

function hasClosingCodeRun(source: string, from: number, length: number): boolean {
	for (const match of source.slice(from).matchAll(/`+/g)) {
		if (match[0].length === length) return true;
	}
	return false;
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
	for (const match of source.matchAll(/[^\n]*(?:\n|$)/g)) {
		if (!match[0]) continue;
		const from = match.index;
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
		if (!comment && !code) {
			if (fenceMatch) { fence = fenceMatch[1]; continue; }
			if (!paragraph && /^(?: {4}|\t)/.test(line)) continue;
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
				else if (!code && hasClosingCodeRun(source, from + end, length)) code = length;
				cursor = end;
			} else if (!code && line.startsWith("%%", cursor)) { comment = true; cursor += 2; }
			else cursor += 1;
		}
		if (!line.trim()) code = 0;
		paragraph = line.trim() !== "" && !/^ {0,3}(?:#{1,6}(?:[ \t]|$)|(?:[-*_][ \t]*){3,}$|(?:=+|-+)[ \t]*$)/.test(line);
	}
	return result;
}
