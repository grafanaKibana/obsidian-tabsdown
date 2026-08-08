export interface ParsedTab {
	label: string;
	body: string;
	icon?: string;
}

export type TabDefinition = ParsedTab;

export interface InlineLabelToken {
	type: "text" | "strong" | "emphasis" | "delete" | "code";
	text: string;
}

export type TabConfiguration = "top" | "left" | "right" | "bottom" | "one" | "multi";

export type TabsDiagnosticCode =
	| "content-before-first-tab"
	| "duplicate-label"
	| "empty-label"
	| "invalid-config"
	| "too-few-tabs"
	| "unclosed-nested-block";

export interface TabsDiagnostic {
	code: TabsDiagnosticCode;
	message: string;
	line: number;
	source: string;
}

export type TabsParseResult =
	| { ok: true; tabs: ParsedTab[]; configuration?: TabConfiguration[] }
	| { ok: false; diagnostic: TabsDiagnostic };

const markerPrefix = "tab:";
const configurationPrefix = "config:";
const iconToken = /^icon:(\S+)\s*/;
const configurationValues = new Set<TabConfiguration>([
	"top",
	"left",
	"right",
	"bottom",
	"one",
	"multi",
]);
const backtickFence = /^ {0,3}(`{3,})([^`]*)$/;
const tildeFence = /^ {0,3}(~{3,})(.*)$/;

const inlineDelimiters = ["**", "~~", "`", "*"] as const;
const inlineTokenTypes = {
	"**": "strong",
	"~~": "delete",
	"`": "code",
	"*": "emphasis",
} as const;

function isEscaped(source: string, index: number): boolean {
	let slashes = 0;
	for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
		slashes += 1;
	}
	return slashes % 2 === 1;
}

function overlapsDelimiterRun(
	source: string,
	delimiter: (typeof inlineDelimiters)[number],
	index: number,
): boolean {
	const marker = delimiter[0];
	return (
		source[index - 1] === marker ||
		source[index + delimiter.length] === marker
	);
}

function findClosingDelimiter(
	source: string,
	delimiter: (typeof inlineDelimiters)[number],
	start: number,
): number {
	for (let index = start; index <= source.length - delimiter.length; index += 1) {
		if (!source.startsWith(delimiter, index) || isEscaped(source, index)) continue;
		if (overlapsDelimiterRun(source, delimiter, index)) continue;
		return index;
	}
	return -1;
}

function containsInlineDelimiter(source: string): boolean {
	for (let index = 0; index < source.length; index += 1) {
		if (
			inlineDelimiters.some((delimiter) => source.startsWith(delimiter, index)) &&
			!isEscaped(source, index)
		) {
			return true;
		}
	}
	return false;
}

function unescapeInlineText(source: string): string {
	return source.replace(/\\([*~`\\])/g, "$1");
}

export function parseInlineLabel(source: string): InlineLabelToken[] {
	const tokens: InlineLabelToken[] = [];
	let text = "";
	const flushText = (): void => {
		if (text !== "") tokens.push({ type: "text", text });
		text = "";
	};

	for (let index = 0; index < source.length; ) {
		if (source[index] === "\\" && /[*~`\\]/.test(source[index + 1] ?? "")) {
			text += source[index + 1] ?? "";
			index += 2;
			continue;
		}

		const delimiter = inlineDelimiters.find((candidate) => {
			if (!source.startsWith(candidate, index)) return false;
			return !overlapsDelimiterRun(source, candidate, index);
		});
		if (!delimiter) {
			text += source[index] ?? "";
			index += 1;
			continue;
		}

		const close = findClosingDelimiter(source, delimiter, index + delimiter.length);
		if (close < 0) {
			text += delimiter;
			index += delimiter.length;
			continue;
		}
		const raw = source.slice(index + delimiter.length, close);
		if (
			raw.trim() === "" ||
			(delimiter !== "`" && containsInlineDelimiter(raw))
		) {
			text += source.slice(index, close + delimiter.length);
			index = close + delimiter.length;
			continue;
		}

		flushText();
		tokens.push({
			type: inlineTokenTypes[delimiter],
			text: delimiter === "`" ? raw : unescapeInlineText(raw),
		});
		index = close + delimiter.length;
	}

	flushText();
	return tokens;
}

export function inlineLabelText(tokens: readonly InlineLabelToken[]): string {
	return tokens.map((token) => token.text).join("");
}

export function parseTabs(source: string): TabsParseResult {
	const tabs: ParsedTab[] = [];
	const configuration: TabConfiguration[] = [];
	const labels = new Set<string>();
	const lines = source.split("\n");
	let current: ParsedTab | undefined;
	let openFence: string | undefined;
	let nested = false;
	let nestedLine = 0;

	const fail = (
		code: TabsDiagnosticCode,
		message: string,
		line: number,
	): TabsParseResult => ({
		ok: false,
		diagnostic: { code, message, line, source },
	});

	for (const [index, rawLine] of lines.entries()) {
		const hasNewline = index < lines.length - 1;
		const hasCarriageReturn = hasNewline && rawLine.endsWith("\r");
		const line = hasCarriageReturn ? rawLine.slice(0, -1) : rawLine;
		const ending = hasNewline ? (hasCarriageReturn ? "\r\n" : "\n") : "";
		const lineNumber = index + 1;

		const fenceMatch = backtickFence.exec(line) ?? tildeFence.exec(line);
		const fenceRun = fenceMatch?.[1];
		const fenceInfo = fenceMatch?.[2] ?? "";

		if (openFence) {
			if (fenceRun?.startsWith(openFence) && /^[ \t]*$/.test(fenceInfo)) {
				openFence = undefined;
				nested = false;
			}
		} else if (fenceRun) {
			openFence = fenceRun;
			// A nested block owns its own markers. CommonMark already forces the
			// outer fence to be the longer one, so the close above cannot be stolen
			// by an inner fence.
			nested = /^[ \t]*([^ \t]*)/.exec(fenceInfo)?.[1] === "tabsdown";
			nestedLine = lineNumber;
		}

		if (!nested && current === undefined && line.startsWith(configurationPrefix)) {
			const values = line
				.slice(configurationPrefix.length)
				.split(",")
				.map((value) => value.trim());
			if (values.length === 1 && values[0] === "") {
				return fail(
					"invalid-config",
					"A config marker must list at least one value.",
					lineNumber,
				);
			}
			for (const value of values) {
				if (!configurationValues.has(value as TabConfiguration)) {
					return fail(
						"invalid-config",
						`Unknown configuration value "${value}".`,
						lineNumber,
					);
				}
				configuration.push(value as TabConfiguration);
			}
			continue;
		}

		if (!nested && line.startsWith(markerPrefix)) {
			const marker = line.slice(markerPrefix.length).trim();
			const iconMatch = iconToken.exec(marker);
			const icon = iconMatch?.[1];
			let label = iconMatch ? marker.slice(iconMatch[0].length) : marker;
			if (!iconMatch && label.startsWith("\\icon:")) {
				label = label.slice(1);
			}
			if (label === "") {
				return fail("empty-label", "Tab labels must not be empty.", lineNumber);
			}
			if (labels.has(label)) {
				return fail(
					"duplicate-label",
					`Duplicate tab label "${label}".`,
					lineNumber,
				);
			}

			current = { label, body: "", ...(icon ? { icon } : {}) };
			tabs.push(current);
			labels.add(label);
			openFence = undefined;
			continue;
		}

		if (current === undefined) {
			if (line.trim() === "") {
				continue;
			}
			return fail(
				"content-before-first-tab",
				"Content before the first tab marker is not allowed.",
				lineNumber,
			);
		}

		// Nested source stays verbatim; the inner block unescapes its own markers.
		current.body += !nested && line.startsWith(`\\${markerPrefix}`)
			? `${line.slice(1)}${ending}`
			: `${line}${ending}`;
	}

	// Checked before the tab count, because an unclosed nested block swallows every
	// marker after it and would otherwise surface as a missing tab.
	if (nested) {
		return fail(
			"unclosed-nested-block",
			"A nested tabs block is never closed.",
			nestedLine,
		);
	}

	if (tabs.length < 2) {
		return fail(
			"too-few-tabs",
			"A tabs block must contain at least two tabs.",
			1,
		);
	}

	return {
		ok: true,
		tabs,
		...(configuration.length > 0 ? { configuration } : {}),
	};
}
