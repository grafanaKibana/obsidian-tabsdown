export interface SeparatorTracker {
	refresh(): void;
	destroy(): void;
}

function midpoint(first: number, second: number): number {
	return (first + second) / 2;
}

function sameLane(previous: DOMRect, current: DOMRect, vertical: boolean): boolean {
	return vertical
		? Math.min(previous.right, current.right) - Math.max(previous.left, current.left) > 1
		: Math.min(previous.bottom, current.bottom) - Math.max(previous.top, current.top) > 1;
}

const lineStartClass = "tabsdown__tab--line-start";
const lineEndClass = "tabsdown__tab--line-end";
const columnClass = "tabsdown__tablist--column";
const buttonClass = "tabsdown__tablist--button";
const railClass = "tabsdown__tablist--rail";
const personalities = ["button", "underline", "separator", "rail"] as const;

function markLane(
	buttons: readonly HTMLElement[],
	starts: Set<HTMLElement>,
	ends: Set<HTMLElement>,
): void {
	const first = buttons[0];
	const last = buttons[buttons.length - 1];
	if (first) starts.add(first);
	if (last) ends.add(last);
}

export function trackSeparators(
	tabList: HTMLElement,
	buttons: readonly HTMLElement[] | (() => readonly HTMLElement[]),
): SeparatorTracker {
	const view = tabList.ownerDocument.defaultView;
	let observer: ResizeObserver | undefined;
	let mutations: MutationObserver | undefined;
	const knownButtons = new Set<HTMLElement>();
	const currentButtons = (): readonly HTMLElement[] =>
		typeof buttons === "function" ? buttons() : buttons;

	const refresh = (): void => {
		const computed = typeof view?.getComputedStyle === "function"
			? view.getComputedStyle(tabList)
			: undefined;
		const vertical = computed?.flexDirection.startsWith("column") ?? false;
		const root = tabList.parentElement;
		const personality = personalities.find((value) =>
			root?.classList.contains(`tabsdown--personality-${value}`),
		) ?? computed?.getPropertyValue("--tabsdown-resolved-personality").trim();
		tabList.classList.toggle(columnClass, vertical);
		tabList.classList.toggle(buttonClass, !personality || personality === "button");
		tabList.classList.toggle(railClass, personality === "rail");
		const visibleButtons = currentButtons();
		const current = new Set(visibleButtons);
		for (const button of knownButtons) {
			if (current.has(button)) continue;
			button.classList.remove(lineStartClass, lineEndClass);
			button.querySelector<HTMLElement>(".tabsdown__separator")?.classList.remove(
				"tabsdown__separator--column",
			);
			observer?.unobserve(button);
			knownButtons.delete(button);
		}
		for (const button of visibleButtons) {
			if (!knownButtons.has(button)) {
				knownButtons.add(button);
				observer?.observe(button);
			}
			button.querySelector<HTMLElement>(".tabsdown__separator")?.classList.toggle(
				"tabsdown__separator--column",
				vertical,
			);
		}
		let previous: DOMRect | undefined;
		let lane: HTMLElement[] = [];
		const starts = new Set<HTMLElement>();
		const ends = new Set<HTMLElement>();
		for (const button of visibleButtons) {
			const separator = button.querySelector<HTMLElement>(".tabsdown__separator");
			if (button.hidden) continue;

			const current = button.getBoundingClientRect();
			const startsLine = previous === undefined || !sameLane(previous, current, vertical);
			if (startsLine) {
				markLane(lane, starts, ends);
				lane = [];
			}
			lane.push(button);
			if (separator) {
				separator.hidden = startsLine;
				separator.style.setProperty(
					"--tabsdown-separator-length",
					`${(vertical ? current.width : current.height) * 0.8}px`,
				);
				if (!startsLine && previous) {
					if (vertical) {
						separator.style.left = `${current.width / 2}px`;
						separator.style.top = `${midpoint(previous.bottom, current.top) - current.top}px`;
					} else {
						const facingPrevious = current.left >= previous.right ? previous.right : previous.left;
						const facingCurrent = current.left >= previous.right ? current.left : current.right;
						separator.style.left = `${midpoint(facingPrevious, facingCurrent) - current.left}px`;
						separator.style.top = `${current.height / 2}px`;
					}
				}
			}
			previous = current;
		}
		markLane(lane, starts, ends);
		for (const button of visibleButtons) {
			button.classList.toggle(lineStartClass, starts.has(button));
			button.classList.toggle(lineEndClass, ends.has(button));
		}
	};

	if (view?.ResizeObserver) {
		observer = new view.ResizeObserver(refresh);
		observer.observe(tabList);
	}
	refresh();
	if (view?.MutationObserver) {
		const observeAncestors = (): void => {
			mutations?.disconnect();
			if (!tabList.isConnected) {
				mutations?.observe(tabList.ownerDocument, { childList: true, subtree: true });
			}
			for (let node: Node | null = tabList; node; ) {
				mutations?.observe(node, {
					childList: true,
					...(node.nodeType === 1
						? {
								attributes: true,
								attributeFilter: (node as Element).classList.contains(
									"tabsdown__panels",
								)
									? ["class", "dir"]
									: ["class", "style", "dir"],
							}
						: {}),
				});
				node =
					node.parentNode ??
					("host" in node ? (node as ShadowRoot).host : null);
			}
		};
		mutations = new view.MutationObserver(() => {
			observeAncestors();
			refresh();
		});
		observeAncestors();
	}

	return {
		refresh,
		destroy(): void {
			observer?.disconnect();
			mutations?.disconnect();
			tabList.classList.remove(columnClass);
			tabList.classList.remove(buttonClass);
			tabList.classList.remove(railClass);
			for (const button of knownButtons) {
				button.classList.remove(lineStartClass, lineEndClass);
				button.querySelector<HTMLElement>(".tabsdown__separator")?.classList.remove(
					"tabsdown__separator--column",
				);
			}
			knownButtons.clear();
		},
	};
}
