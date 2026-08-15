import "obsidian";

import type { InlineLabelToken } from "./parser";

const tokenTags = {
	strong: "strong",
	emphasis: "em",
	delete: "del",
	code: "code",
} as const;

export function createElement<K extends keyof HTMLElementTagNameMap>(
	parent: Node,
	tag: K,
): HTMLElementTagNameMap[K] {
	return Node.prototype.createEl.call(parent, tag) as HTMLElementTagNameMap[K];
}

export function renderLabel(
	parent: HTMLElement,
	tokens: readonly InlineLabelToken[],
): void {
	for (const token of tokens) {
		if (token.type === "text") {
			parent.append(parent.ownerDocument.createTextNode(token.text));
			continue;
		}
		const element = createElement(parent, tokenTags[token.type]);
		element.textContent = token.text;
	}
}
