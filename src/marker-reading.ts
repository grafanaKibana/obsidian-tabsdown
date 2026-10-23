import { MarkdownRenderChild, type Component, type MarkdownPostProcessorContext, type MarkdownSectionInformation, type Plugin } from "obsidian";
import { sourceBlocks } from "./source";

export type MarkerMarkdownRenderer = (
	markdown: string,
	element: HTMLElement,
	context: MarkdownPostProcessorContext,
	owner: Component,
) => Promise<void>;

interface Section {
	element: HTMLElement;
	context: MarkdownPostProcessorContext;
	info: MarkdownSectionInformation;
	owner: MarkdownRenderChild;
}

interface Render {
	entries: Section[];
	markerEntries: Section[];
	host: HTMLElement;
	dispose(): void;
}

interface Coordinator {
	source: string;
	sections: Map<HTMLElement, Section>;
	renders: Set<Render>;
	footnotes: Map<HTMLElement, { hidden: boolean; hadClass: boolean }>;
	disposed: boolean;
	dispose(): void;
}

/** Coordinate original preview sections; synthetic panel Markdown is rendered by the caller. */
export function registerMarkerReading(plugin: Plugin, renderMarkdown: MarkerMarkdownRenderer): void {
	const containers = new WeakMap<HTMLElement, Map<string, Coordinator>>();
	const active = new Set<Coordinator>();
	const pending = new Map<HTMLElement, () => void>();
	let unloaded = false;
	plugin.register(() => {
		unloaded = true;
		for (const cancel of pending.values()) cancel();
		pending.clear();
		for (const current of active) current.dispose();
	});

	function reconcileFootnotes(current: Coordinator, container: HTMLElement): void {
		const originals = (element: Element) => !element.closest(".tabsdown, .tabsdown-marker-reading");
		const references = Array.from(container.querySelectorAll<HTMLAnchorElement>(".footnote-ref a[href]"))
			.filter(originals);
		const replacements = new Map<Render, Set<string>>();
		for (const render of current.renders) {
			if (render.host.hidden) continue;
			const definitions = new Set(Array.from(render.host.querySelectorAll(".footnotes li[id]"), (entry) => entry.id));
			const labels = new Set<string>();
			for (const reference of Array.from(render.host.querySelectorAll<HTMLAnchorElement>(".footnote-ref a[data-footref]"))) {
				const label = reference.getAttribute("data-footref");
				const target = reference.getAttribute("href");
				if (label && target?.startsWith("#") && definitions.has(target.slice(1))) labels.add(label);
			}
			replacements.set(render, labels);
		}
		const covered = (reference: HTMLAnchorElement) => [...replacements].some(([render, labels]) =>
			labels.has(reference.getAttribute("data-footref") ?? "") &&
			render.markerEntries.some((entry) => entry.element.contains(reference)));
		const wanted = new Set<HTMLElement>();
		if (!current.disposed) {
			for (const footer of Array.from(container.querySelectorAll<HTMLElement>(".footnotes")).filter(originals)) {
				const entries = Array.from(footer.querySelectorAll<HTMLElement>("li[id]"));
				for (const entry of entries) {
					const links = references.filter((reference) => reference.getAttribute("href") === `#${entry.id}`);
					// Keep a shared native definition whenever an ordinary note reference uses it.
					if (links.length && links.every(covered)) wanted.add(entry);
				}
				if (entries.length && entries.every((entry) => wanted.has(entry))) wanted.add(footer);
			}
		}
		for (const [element, previous] of current.footnotes) {
			if (wanted.has(element)) continue;
			element.hidden = previous.hidden;
			element.classList.toggle("tabsdown-marker-hidden", previous.hadClass);
			current.footnotes.delete(element);
		}
		for (const element of wanted) {
			if (!current.footnotes.has(element)) current.footnotes.set(element, {
				hidden: element.hidden, hadClass: element.classList.contains("tabsdown-marker-hidden"),
			});
			element.hidden = true;
			element.classList.add("tabsdown-marker-hidden");
		}
	}

	function reconcile(current: Coordinator, container: HTMLElement): void {
		if (current.disposed) return;
		const lines = current.source.match(/[^\n]*\n|[^\n]+$/g) ?? [];
		const candidates = sourceBlocks(current.source).filter((block) => block.syntax === "markers" && block.locator.nestedOffsets.length === 0);
		const sections = [...current.sections.values()].sort((a, b) => a.info.lineStart - b.info.lineStart);
		const groups: Array<{ entries: Section[]; lineStart: number; lineEnd: number }> = [];
		for (const candidate of candidates) {
			const entries = sections.filter(({ info }) => info.lineEnd >= candidate.lineStart && info.lineStart <= candidate.lineEnd);
			if (!entries.length) continue;
			const previous = groups[groups.length - 1];
			if (previous && entries.some((entry) => previous.entries.includes(entry))) {
				previous.entries = [...new Set([...previous.entries, ...entries])].sort((a, b) => a.info.lineStart - b.info.lineStart);
				previous.lineEnd = candidate.lineEnd;
			} else groups.push({ entries, lineStart: candidate.lineStart, lineEnd: candidate.lineEnd });
		}
		for (const group of groups) {
			const first = group.entries[0];
			const last = group.entries[group.entries.length - 1];
			if (!first || !last || first.info.lineStart > group.lineStart || last.info.lineEnd < group.lineEnd) continue;
			// A missing nonblank section must never disappear when its neighbors finish rendering.
			if (lines.some((line, index) => index >= first.info.lineStart && index <= last.info.lineEnd && line.trim() && !group.entries.some(({ info }) => info.lineStart <= index && info.lineEnd >= index))) continue;
			const overlapping = [...current.renders].filter((render) => render.entries.some((entry) => group.entries.includes(entry)));
			if (overlapping.some((render) => render.entries.length === group.entries.length && render.entries.every((entry) => group.entries.includes(entry)))) continue;
			for (const render of overlapping) render.dispose();
			const source = current.source;
			const bounds = { text: source, lineStart: first.info.lineStart, lineEnd: last.info.lineEnd };
			const host = first.element.createDiv({ cls: "tabsdown-marker-reading" });
			host.hidden = true;
			const owner = first.owner.addChild(new MarkdownRenderChild(host));
			const original = group.entries.map((entry) => ({ entry, info: { ...entry.info }, nodes: Array.from(entry.element.childNodes).filter((node) => node !== host), content: Array.from(entry.element.childNodes).filter((node) => node !== host).map((node) => node.textContent) }));
			const hidden: Array<{ element: HTMLElement; hidden: boolean; hadClass: boolean }> = [];
			let disposed = false;
			const render: Render = {
				entries: group.entries,
				markerEntries: group.entries.filter(({ info }) => candidates.some((candidate) =>
					info.lineStart >= candidate.lineStart && info.lineEnd <= candidate.lineEnd)),
				host,
				dispose() {
					if (disposed) return;
					disposed = true;
					current.renders.delete(render);
					first.owner.removeChild(owner);
					host.remove();
					for (const state of hidden) {
						state.element.hidden = state.hidden;
						state.element.classList.toggle("tabsdown-marker-hidden", state.hadClass);
					}
					reconcileFootnotes(current, container);
				},
			};
			current.renders.add(render);
			const context: MarkdownPostProcessorContext = {
				...first.context,
				addChild: (child) => { owner.addChild(child); },
				getSectionInfo: () => bounds,
			};
			const markdown = lines.slice(bounds.lineStart, bounds.lineEnd + 1).join("");
			void (async () => {
				try {
					await renderMarkdown(markdown, host, context, owner);
					if (disposed || unloaded || current.disposed || current.source !== source) return;
					const sameSections = original.every(({ entry, info: expected }) => {
						const info = entry.context.getSectionInfo(entry.element);
						return container.contains(entry.element) && current.sections.get(entry.element) === entry && info?.text === source && info.lineStart === expected.lineStart && info.lineEnd === expected.lineEnd;
					});
					const sameContent = original.every(({ entry, nodes, content }) => {
						const children = Array.from(entry.element.childNodes).filter((node) => node !== host);
						return children.length === nodes.length && children.every((node, index) => node === nodes[index] && node.textContent === content[index]);
					});
					if (!sameSections || !sameContent) {
						render.dispose();
						// Native async renderers can finish while our Markdown is rendering.
						// Retry their new DOM only while the source and section identities agree.
						if (sameSections) reconcile(current, container);
						return;
					}
					for (const { nodes } of original) {
						for (const node of nodes) {
							// Preview sections normally contain elements; preserve text nodes reversibly too.
							if (node.nodeType === Node.ELEMENT_NODE) {
								const element = node as HTMLElement;
								hidden.push({ element, hidden: element.hidden, hadClass: element.classList.contains("tabsdown-marker-hidden") });
								element.classList.add("tabsdown-marker-hidden");
								element.hidden = true;
							} else if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
								const wrapper = entryTextWrapper(node);
								owner.register(() => wrapper.replaceWith(...Array.from(wrapper.childNodes)));
								hidden.push({ element: wrapper, hidden: false, hadClass: false });
								wrapper.classList.add("tabsdown-marker-hidden");
								wrapper.hidden = true;
							}
						}
					}
					host.hidden = false;
					reconcileFootnotes(current, container);
				} catch (error) {
					render.dispose();
					console.error(`Tabsdown failed to render marker tabs in ${first.context.sourcePath}.`, error);
				}
			})();
		}
		reconcileFootnotes(current, container);
	}

	function processSection(element: HTMLElement, context: MarkdownPostProcessorContext): void {
		if (unloaded || element.closest(".tabsdown, .tabsdown-marker-widget, .tabsdown-marker-reading")) return;
		const info = context.getSectionInfo(element);
		if (!info) return;
		const container = element.closest<HTMLElement>(".markdown-preview-section") ?? element.parentElement;
		if (!container) {
			if (pending.has(element) || !sourceBlocks(info.text).some((block) => block.syntax === "markers" && block.locator.nestedOffsets.length === 0)) return;
			const lifecycle = new MarkdownRenderChild(element);
			context.addChild(lifecycle);
			const observer = new MutationObserver(() => {
				if (!element.parentElement) return;
				cancel();
				processSection(element, context);
			});
			const cancel = () => { observer.disconnect(); pending.delete(element); };
			pending.set(element, cancel);
			lifecycle.register(cancel);
			observer.observe(element.ownerDocument, { childList: true, subtree: true });
			return;
		}
		let documents = containers.get(container);
		if (!documents) { documents = new Map(); containers.set(container, documents); }
		const key = context.docId || context.sourcePath;
		let current = documents.get(key);
		if (!current || current.disposed) {
			if (!sourceBlocks(info.text).some((block) => block.syntax === "markers" && block.locator.nestedOffsets.length === 0)) return;
			current = {
				source: info.text, sections: new Map(), renders: new Set(), footnotes: new Map(), disposed: false,
				dispose() {
					if (this.disposed) return;
					this.disposed = true;
					for (const render of this.renders) render.dispose();
					this.sections.clear();
					active.delete(this);
				},
			};
			documents.set(key, current);
			active.add(current);
		}
		const coordinator = current;
		if (coordinator.source !== info.text) {
			for (const render of coordinator.renders) render.dispose();
			coordinator.source = info.text;
			for (const [node, entry] of coordinator.sections) {
				const updated = entry.context.getSectionInfo(node);
				if (!container.contains(node) || updated?.text !== info.text) coordinator.sections.delete(node);
				else entry.info = updated;
			}
		}
		const existing = coordinator.sections.get(element);
		if (existing) {
			if (existing.info.lineStart !== info.lineStart || existing.info.lineEnd !== info.lineEnd) {
				for (const render of coordinator.renders) if (render.entries.includes(existing)) render.dispose();
			}
			existing.info = info; existing.context = context;
		}
		else {
			const owner = new MarkdownRenderChild(element);
			context.addChild(owner);
			const entry = { element, context, info, owner };
			coordinator.sections.set(element, entry);
			owner.register(() => {
				if (coordinator.sections.get(element) !== entry) return;
				coordinator.sections.delete(element);
				for (const render of coordinator.renders) if (render.entries.includes(entry)) render.dispose();
				if (!coordinator.sections.size) {
					coordinator.dispose();
					if (documents.get(key) === coordinator) documents.delete(key);
				}
			});
		}
		reconcile(coordinator, container);
	}
	plugin.registerMarkdownPostProcessor(processSection);
}

function entryTextWrapper(node: Node): HTMLElement {
	const wrapper = node.parentElement!.createDiv();
	node.parentNode!.insertBefore(wrapper, node);
	wrapper.append(node);
	return wrapper;
}
