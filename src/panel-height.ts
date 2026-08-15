const FLOOR_CAP_MS = 2500;

// Dataview, Datacore and mermaid render an empty container from the markdown
// post-processor and fill it whenever their query resolves; an unresolved
// internal embed has the same shape. Until then the panel measures as though it
// holds nothing at all.
const PENDING_SELECTOR =
	'[class*="block-language-"]:empty, .internal-embed:empty';

const TRANSITION_EVENTS = [
	"transitionstart",
	"transitionend",
	"transitioncancel",
] as const;
const RESOURCE_EVENTS = ["load", "error"] as const;

export interface PanelHeightTracker {
	// Pin the height being left behind, then move to whichever panel is visible.
	switched(from: number): void;
	// Re-read the visible panel, for a change no resize reports.
	refresh(): void;
	destroy(): void;
}

// The box follows the visible panel's height for as long as it is mounted rather
// than measuring a target once and animating at it. A height measured the moment
// a panel appears is a guess about content that has not finished arriving, and
// every one of those guesses ends as a visible jump when the guess expires.
export function trackPanelHeight(
	panelsEl: HTMLElement,
	isLoading: () => boolean = () => false,
): PanelHeightTracker {
	const view = panelsEl.ownerDocument.defaultView;
	let observer: ResizeObserver | undefined;
	let mutationObserver: MutationObserver | undefined;
	let watched: HTMLElement | undefined;
	let resizeTargets: Element[] = [];
	let shadowRoots: ShadowRoot[] = [];
	let floor = 0;
	let floorTimer: number | undefined;
	let settleFrame: number | undefined;
	let target = 0;
	let minimum = 0;
	let transitioning = false;
	let wasConnected = false;
	// Until the first switch the box is left on its own height, so a block still
	// rendering when its note opens grows the way any other content does. Pinning
	// that early would fix the box before anything is watching it.
	let tracking = false;

	// Scoped to the visible panel: a hidden panel keeps its own unfilled
	// containers in the tree, and those must not hold the floor down.
	const visiblePanel = (): HTMLElement | null =>
		panelsEl.querySelector<HTMLElement>(
			":scope > .tabsdown__panel:not([hidden])",
		);
	const composedParent = (element: Element): Element | null => {
		if (element.assignedSlot) return element.assignedSlot;
		if (element.parentElement) return element.parentElement;
		const root = element.getRootNode();
		return root.nodeType === 11 && "host" in root
			? (root as ShadowRoot).host
			: null;
	};
	const openShadowRoots = (panel: HTMLElement): ShadowRoot[] => {
		const roots: ShadowRoot[] = [];
		const visit = (root: ParentNode, includeRoot?: Element): void => {
			const elements = includeRoot
				? [includeRoot, ...Array.from(root.querySelectorAll("*"))]
				: Array.from(root.querySelectorAll("*"));
			for (const element of elements) {
				if (!element.shadowRoot) continue;
				roots.push(element.shadowRoot);
				visit(element.shadowRoot);
			}
		};
		visit(panel, panel);
		return roots;
	};
	const participatesInLayout = (
		candidate: Element,
		panel: HTMLElement,
	): boolean => {
		if (!panel.isConnected) return false;
		let current: Element | null = candidate;
		while (current && current !== panelsEl) {
			if (current.hasAttribute("hidden")) return false;
			const style = view?.getComputedStyle(current);
			if (style?.display === "none" || style?.contentVisibility === "hidden") {
				return false;
			}
			const parent = composedParent(current);
			if (parent?.tagName === "DETAILS" && !parent.hasAttribute("open")) {
				const summary = Array.from(parent.children).find(
					(child) => child.tagName === "SUMMARY",
				);
				if (!summary?.contains(current)) return false;
			}
			current = parent;
		}
		return current === panelsEl;
	};
	const hasPendingContent = (panel: HTMLElement | null): boolean => {
		if (!panel) return false;
		const roots: ParentNode[] = [panel, ...openShadowRoots(panel)];
		const candidates: Element[] = panel.matches(`${PENDING_SELECTOR}, img`)
			? [panel]
			: [];
		for (const root of roots) {
			candidates.push(
				...Array.from(root.querySelectorAll(`${PENDING_SELECTOR}, img`)),
			);
		}
		return candidates.some(
			(candidate) =>
				participatesInLayout(candidate, panel) &&
				(candidate.matches(PENDING_SELECTOR) ||
					(candidate.tagName === "IMG" &&
						!(candidate as HTMLImageElement).complete)),
		);
	};

	const dropFloor = (): void => {
		floor = 0;
		mutationObserver?.disconnect();
		if (floorTimer !== undefined) {
			view?.clearTimeout(floorTimer);
			floorTimer = undefined;
		}
	};
	const pixels = (value: string | undefined): number => {
		const parsed = Number.parseFloat(value ?? "");
		return Number.isFinite(parsed) ? parsed : 0;
	};
	const measure = (
		panel: HTMLElement | null,
	): { content: number; natural: number } => {
		if (!panel) return { content: 0, natural: 0 };
		const pinned = panelsEl.style.height;
		const reserved = panelsEl.style.minHeight;
		panelsEl.style.removeProperty("height");
		panelsEl.style.removeProperty("min-height");
		const style = view?.getComputedStyle(panel);
		const marginBox =
			style?.display === "contents"
				? 0
				: panel.getBoundingClientRect().height +
					pixels(style?.marginTop) +
					pixels(style?.marginBottom);
		const natural = panelsEl.getBoundingClientRect().height;
		if (pinned) panelsEl.style.height = pinned;
		if (reserved) panelsEl.style.minHeight = reserved;
		return { content: marginBox, natural };
	};

	const apply = (): void => {
		if (!tracking) return;
		if (panelsEl.isConnected) wasConnected = true;
		else if (wasConnected) return;
		const panel = visiblePanel();
		// The floor outlives the switch only while content is still on its way, so
		// a panel that is merely shorter than the last one shrinks straight away.
		const holding =
			floor > 0 && (isLoading() || hasPendingContent(panel));
		// Keep the switch floor available until its cap even when it is not needed
		// yet. An async host can insert its placeholder just after the switch.
		const measured = measure(panel);
		const physical = Math.max(measured.content, measured.natural);
		// Rounding up: half a pixel short is a clipped descender for as long as the
		// container is clipping its overflow.
		target = Math.ceil(
			holding ? Math.max(physical, floor) : physical,
		);
		minimum = measured.natural < target ? target : 0;
		const value = `${target}px`;
		if (transitioning) {
			if (panelsEl.style.height !== value) panelsEl.style.height = value;
		} else if (minimum > 0) {
			if (panelsEl.style.minHeight !== `${minimum}px`) {
				panelsEl.style.minHeight = `${minimum}px`;
			}
		} else {
			panelsEl.style.removeProperty("min-height");
		}
	};
	const boxTargets = (panel: HTMLElement): Element[] => {
		if (view?.getComputedStyle(panel).display !== "contents") return [panel];
		const targets: Element[] = [panelsEl];
		const visit = (root: ParentNode): void => {
			for (const child of Array.from(root.children)) {
				const display = view?.getComputedStyle(child).display;
				if (display === "none") continue;
				if (display === "contents") {
					visit(child);
					if (child.shadowRoot) visit(child.shadowRoot);
				} else {
					targets.push(child);
				}
			}
		};
		visit(panel);
		if (panel.shadowRoot) visit(panel.shadowRoot);
		return targets;
	};
	const watch = (panel: HTMLElement | null, rescan = false): void => {
		if (!rescan && panel === (watched ?? null)) return;
		for (const target of resizeTargets) observer?.unobserve(target);
		for (const root of shadowRoots) {
			for (const type of RESOURCE_EVENTS) {
				root.removeEventListener(type, apply, true);
			}
		}
		mutationObserver?.disconnect();
		watched = panel ?? undefined;
		resizeTargets = [];
		shadowRoots = [];
		if (!watched) return;

		resizeTargets = boxTargets(watched);
		for (const target of resizeTargets) observer?.observe(target);
		shadowRoots = openShadowRoots(watched);
		for (const root of shadowRoots) {
			for (const type of RESOURCE_EVENTS) {
				root.addEventListener(type, apply, true);
			}
		}
		const mutationOptions: MutationObserverInit = {
			attributes: true,
			attributeFilter: [
				"class",
				"hidden",
				"open",
				"sizes",
				"src",
				"srcset",
				"style",
			],
			characterData: true,
			childList: true,
			subtree: true,
		};
		if (floor > 0) {
			mutationObserver?.observe(watched, mutationOptions);
			for (const root of shadowRoots) {
				mutationObserver?.observe(root, mutationOptions);
			}
		}
	};
	const settle = (): void => {
		settleFrame = undefined;
		transitioning = false;
		if (minimum > 0) {
			panelsEl.style.minHeight = `${minimum}px`;
		} else {
			panelsEl.style.removeProperty("min-height");
		}
		panelsEl.style.removeProperty("height");
		panelsEl.classList.remove("tabsdown__panels--animating");
	};
	const scheduleSettle = (): void => {
		if (!view) {
			settle();
			return;
		}
		if (settleFrame !== undefined) view.cancelAnimationFrame(settleFrame);
		settleFrame = view.requestAnimationFrame(settle);
	};

	const onTransition = (event: TransitionEvent): void => {
		if (event.target !== panelsEl || event.propertyName !== "height") return;
		if (event.type === "transitionstart") {
			if (settleFrame !== undefined) {
				view?.cancelAnimationFrame(settleFrame);
				settleFrame = undefined;
			}
			panelsEl.classList.add("tabsdown__panels--animating");
			return;
		}
		// Retargeting mid-flight cancels one transition and starts another in the
		// same frame, so releasing on the next one keeps the clip on across the gap.
		scheduleSettle();
	};

	for (const type of TRANSITION_EVENTS) {
		panelsEl.addEventListener(type, onTransition as EventListener);
	}
	for (const type of RESOURCE_EVENTS) {
		panelsEl.addEventListener(type, apply, true);
	}

	return {
		switched(from: number): void {
			tracking = true;
			floor = from;
			if (floorTimer !== undefined) view?.clearTimeout(floorTimer);
			floorTimer = view?.setTimeout(() => {
				floorTimer = undefined;
				dropFloor();
				apply();
			}, FLOOR_CAP_MS);
			if (!observer && view?.ResizeObserver) {
				observer = new view.ResizeObserver(apply);
			}
			if (!mutationObserver && view?.MutationObserver) {
				mutationObserver = new view.MutationObserver(() => {
					if (!tracking || floor === 0) return;
					watch(visiblePanel(), true);
					apply();
				});
			}
			watch(visiblePanel(), true);
			if (settleFrame !== undefined) view?.cancelAnimationFrame(settleFrame);
			panelsEl.style.removeProperty("min-height");
			panelsEl.style.height = `${Math.ceil(from)}px`;
			// Flushing the pin makes it the value the transition starts from. Both
			// writes otherwise land in one frame and the box jumps to the target.
			void panelsEl.offsetHeight;
			transitioning = true;
			apply();
			scheduleSettle();
		},

		refresh: apply,

		destroy(): void {
			tracking = false;
			dropFloor();
			observer?.disconnect();
			observer = undefined;
			mutationObserver?.disconnect();
			mutationObserver = undefined;
			for (const root of shadowRoots) {
				for (const type of RESOURCE_EVENTS) {
					root.removeEventListener(type, apply, true);
				}
			}
			watched = undefined;
			resizeTargets = [];
			shadowRoots = [];
			if (settleFrame !== undefined) view?.cancelAnimationFrame(settleFrame);
			for (const type of TRANSITION_EVENTS) {
				panelsEl.removeEventListener(type, onTransition as EventListener);
			}
			for (const type of RESOURCE_EVENTS) {
				panelsEl.removeEventListener(type, apply, true);
			}
			panelsEl.style.removeProperty("height");
			panelsEl.style.removeProperty("min-height");
			panelsEl.classList.remove("tabsdown__panels--animating");
		},
	};
}
