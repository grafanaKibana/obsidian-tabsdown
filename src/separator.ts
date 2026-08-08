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

export function trackSeparators(
	tabList: HTMLElement,
	buttons: readonly HTMLButtonElement[],
): SeparatorTracker {
	const view = tabList.ownerDocument.defaultView;
	let observer: ResizeObserver | undefined;
	let mutations: MutationObserver | undefined;

	const refresh = (): void => {
		const vertical =
			(typeof view?.getComputedStyle === "function" &&
				view.getComputedStyle(tabList).flexDirection.startsWith("column")) ||
			false;
		let previous: DOMRect | undefined;
		for (const button of buttons) {
			const separator = button.querySelector<HTMLElement>(".tabsdown__separator");
			if (!separator || button.hidden) continue;

			const current = button.getBoundingClientRect();
			const startsLine = previous === undefined || !sameLane(previous, current, vertical);
			separator.hidden = startsLine;
			separator.classList.toggle("tabsdown__separator--column", vertical);
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
			previous = current;
		}
	};

	if (view?.ResizeObserver) {
		observer = new view.ResizeObserver(refresh);
		observer.observe(tabList);
		for (const button of buttons) observer.observe(button);
	}
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
	refresh();

	return {
		refresh,
		destroy(): void {
			observer?.disconnect();
			mutations?.disconnect();
		},
	};
}
