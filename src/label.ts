import type { InlineLabelToken } from "./parser";

const tokenTags = {
	strong: "strong",
	emphasis: "em",
	delete: "del",
	code: "code",
} as const;

export function renderLabel(
	parent: HTMLElement,
	tokens: readonly InlineLabelToken[],
): void {
	for (const token of tokens) {
		if (token.type === "text") {
			parent.append(parent.ownerDocument.createTextNode(token.text));
			continue;
		}
		const element = parent.ownerDocument.createElement(tokenTags[token.type]);
		element.textContent = token.text;
		parent.append(element);
	}
}
