import { renderLabel } from "./label";
import { trackPanelHeight, type PanelHeightTracker } from "./panel-height";
import { inlineLabelText, parseInlineLabel } from "./parser";
import { trackSeparators } from "./separator";

export interface TabSpec {
	id: string;
	label: string;
	panel: HTMLElement;
}

export interface MountTabsOptions {
	tabs: readonly TabSpec[];
	selection?: string | null;
	label: string;
	onSelectionChange?: (
		selection: string | null,
		previous: string | null,
	) => void;
}

export interface TabsController {
	readonly selection: string | null;
	setSelection(id: string | null): void;
	setAvailable(id: string, available: boolean): void;
	destroy(): void;
}

const panelAttributes = [
	"id",
	"role",
	"tabindex",
	"aria-labelledby",
	"hidden",
] as const;

let nextMountId = 0;
const mountedPanels = new WeakSet<HTMLElement>();

// These map to role="generic", which prohibits an accessible name, so they are
// the ones that need a role before aria-labelledby means anything. Everything
// else plausible as a panel arrives with a nameable implicit role to preserve.
const genericPanelTags = new Set(["DIV", "SPAN", "PRE"]);

// Disabled and hidden controls match the shape of a focus target without being
// one, and a panel whose only candidate is one of those still needs its own stop.
const focusableSelector =
	'a[href], audio[controls], button:not([disabled]), details, iframe, input:not([disabled]):not([type="hidden"]), select:not([disabled]), summary, textarea:not([disabled]), video[controls], [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"]):not([disabled])';

function isShadowIncludingAncestor(ancestor: Node, node: Node): boolean {
	let current: Node | null = node;
	while (current) {
		if (current === ancestor) return true;
		current =
			current.parentNode ??
			((current.getRootNode() as ShadowRoot).host ?? null);
	}
	return false;
}

// getElementById is missing when the root is a loose element, so this queries
// instead, which every ParentNode supports, and checks the root itself too.
function findById(scope: ParentNode, id: string): Element | null {
	if ("id" in scope && (scope as Element).id === id) return scope as Element;
	return scope.querySelector(`#${CSS.escape(id)}`);
}

// document.activeElement reports the outermost shadow host rather than what is
// actually focused inside it, so this starts at the node's own root and keeps
// descending while each active element hosts a shadow tree of its own.
function activeElementNear(node: Node): Element | null {
	const root = node.getRootNode() as Partial<DocumentOrShadowRoot>;
	let active = root.activeElement ?? null;
	while (active?.shadowRoot?.activeElement) {
		active = active.shadowRoot.activeElement;
	}
	return active;
}

interface MountedTab {
	id: string;
	button: HTMLButtonElement;
	panel: HTMLElement;
	available: boolean;
	restore: Map<string, string | null>;
	hadPanelClass: boolean;
}

export function mountTabs(
	container: HTMLElement,
	options: MountTabsOptions,
): TabsController {
	const groupLabel = parseInlineLabel(options.label);
	const tabLabels = options.tabs.map((tab) => parseInlineLabel(tab.label));
	if (options.tabs.length === 0) {
		throw new Error("Tabsdown: mountTabs needs at least one tab.");
	}
	if (options.label.trim() === "") {
		throw new Error("Tabsdown: mountTabs needs a nonblank group label.");
	}
	if (options.tabs.some((tab) => tab.label.trim() === "")) {
		throw new Error("Tabsdown: mountTabs tab labels must not be blank.");
	}
	if (
		new Set(options.tabs.map((tab) => tab.id)).size !== options.tabs.length
	) {
		throw new Error("Tabsdown: mountTabs tab ids must be unique.");
	}
	if (
		new Set(options.tabs.map((tab) => tab.panel)).size !== options.tabs.length
	) {
		throw new Error("Tabsdown: mountTabs panel elements must be unique.");
	}
	// ponytail: tab groups are small; index ancestors if large mounts ever matter.
	if (
		options.tabs.some((tab, index) =>
			options.tabs.some(
				(other, otherIndex) =>
					index !== otherIndex &&
					isShadowIncludingAncestor(tab.panel, other.panel),
			),
		)
	) {
		throw new Error("Tabsdown: mounted panels must not contain each other.");
	}
	if (options.tabs.some((tab) => mountedPanels.has(tab.panel))) {
		throw new Error("Tabsdown: a panel is already mounted.");
	}
	const panelIds = options.tabs.map((tab) => tab.panel.id).filter(Boolean);
	if (new Set(panelIds).size !== panelIds.length) {
		throw new Error("Tabsdown: mountTabs panel DOM ids must be unique.");
	}
	const ownerDocument = container.ownerDocument;
	// Both, because neither alone is enough: the root node covers a shadow tree or
	// a detached fragment that the document cannot see into, and the document
	// covers a container still detached from the tree it is about to join.
	const idScopes = Array.from(
		new Set<ParentNode>([container.getRootNode() as ParentNode, ownerDocument]),
	);
	const findMountedId = (id: string): Element | null => {
		for (const scope of idScopes) {
			const found = findById(scope, id);
			if (found !== null) return found;
		}
		return null;
	};
	if (
		options.tabs.some((tab) => {
			const existing = tab.panel.id ? findMountedId(tab.panel.id) : null;
			return existing !== null && existing !== tab.panel;
		})
	) {
		throw new Error(
			"Tabsdown: a panel DOM id is already used in the target tree.",
		);
	}
	if (
		options.tabs.some((tab) =>
			isShadowIncludingAncestor(tab.panel, container),
		)
	) {
		throw new Error("Tabsdown: a mounted panel cannot contain its container.");
	}
	if (container.querySelector(":scope > .tabsdown--mounted")) {
		throw new Error("Tabsdown: this container already has mounted tabs.");
	}

	const ElementConstructor = ownerDocument.defaultView?.Element ?? Element;
	const mountId = `tabsdown-mount-${++nextMountId}`;
	// The counter restarts whenever the plugin reloads, so a generated id can
	// meet a leftover one from the previous load. Probe rather than assume.
	// Seeded with every id arriving inside the panels, which are about to enter
	// this tree but cannot be found in it yet when a panel is detached or foreign.
	const assignedIds = new Set<string>(
		options.tabs
			.flatMap((tab) => [
				tab.panel.id,
				...Array.from(tab.panel.querySelectorAll("[id]"), (el) => el.id),
			])
			.filter(Boolean),
	);
	const uniqueId = (base: string): string => {
		let candidate = base;
		for (
			let suffix = 1;
			assignedIds.has(candidate) || findMountedId(candidate) !== null;
			suffix += 1
		) {
			candidate = `${base}-${suffix}`;
		}
		assignedIds.add(candidate);
		return candidate;
	};
	const root = ownerDocument.createElement("div");
	root.className = "tabsdown tabsdown--mounted";
	root.tabIndex = -1;

	const tabList = ownerDocument.createElement("div");
	tabList.className = "tabsdown__tablist";
	tabList.setAttribute("role", "group");
	tabList.setAttribute("aria-label", inlineLabelText(groupLabel));

	const panelsEl = ownerDocument.createElement("div");
	panelsEl.className = "tabsdown__panels";

	const height: PanelHeightTracker = trackPanelHeight(panelsEl);
	// Captured before any panel moves: panelsEl is still detached, so appending a
	// panel that holds the focused element would otherwise drop focus outright.
	const focusedSpec = options.tabs.find((tab) => {
		const active = activeElementNear(tab.panel);
		return active !== null && isShadowIncludingAncestor(tab.panel, active);
	});
	const focusedElement = focusedSpec
		? activeElementNear(focusedSpec.panel)
		: null;
	// Claimed before the first DOM move. Appending a panel can fire a custom
	// element's disconnectedCallback, which runs before append returns, so a
	// reentrant mount would otherwise slip past the guard and share these panels.
	for (const tab of options.tabs) mountedPanels.add(tab.panel);
	const tabs: MountedTab[] = options.tabs.map((tab, index) => {
		const buttonId = uniqueId(`${mountId}-tab-${index}`);
		const button = ownerDocument.createElement("button");
		button.type = "button";
		button.id = buttonId;
		button.className = "tabsdown__tab";
		const separator = ownerDocument.createElement("span");
		separator.className = "tabsdown__separator";
		separator.setAttribute("aria-hidden", "true");
		separator.hidden = true;
		button.append(separator);
		const content = ownerDocument.createElement("span");
		content.className = "tabsdown__tab-content";
		button.append(content);
		const label = ownerDocument.createElement("span");
		label.className = "tabsdown__tab-label";
		renderLabel(label, tabLabels[index] ?? []);
		content.append(label);
		const reserve = ownerDocument.createElement("span");
		reserve.className = "tabsdown__tab-reserve";
		reserve.setAttribute("aria-hidden", "true");
		renderLabel(reserve, tabLabels[index] ?? []);
		content.append(reserve);
		tabList.append(button);

		const restore = new Map<string, string | null>(
			panelAttributes.map((name) => [name, tab.panel.getAttribute(name)]),
		);
		// A caller that already identifies its own panel keeps that id, so its
		// lookups still resolve while the panel is mounted.
		if (!tab.panel.id) tab.panel.id = uniqueId(`${mountId}-panel-${index}`);
		if (
			!tab.panel.getAttribute("role")?.trim() &&
			genericPanelTags.has(tab.panel.tagName)
		) {
			tab.panel.setAttribute("role", "group");
		}
		// A panel that already carries a name keeps it. aria-controls on the button
		// still records the relationship, and the caller's name is usually the
		// better one anyway.
		const named =
			tab.panel.getAttribute("aria-labelledby")?.trim() ||
			tab.panel.getAttribute("aria-label")?.trim();
		if (!named) tab.panel.setAttribute("aria-labelledby", buttonId);
		// A scrollable region needs a tab stop only when nothing inside it can take
		// one. Adding it regardless puts the wrapper ahead of the caller's own
		// controls, a stop their DOM did not have before mounting.
		if (
			!tab.panel.hasAttribute("tabindex") &&
			tab.panel.querySelector(focusableSelector) === null
		) {
			tab.panel.tabIndex = 0;
		}
		button.setAttribute("aria-controls", tab.panel.id);

		const hadPanelClass = tab.panel.classList.contains("tabsdown__panel");
		tab.panel.classList.add("tabsdown__panel");
		panelsEl.append(tab.panel);

		return {
			id: tab.id,
			button,
			panel: tab.panel,
			available: true,
			restore,
			hadPanelClass,
		};
	});

	root.append(tabList, panelsEl);
	container.append(root);
	const separators = trackSeparators(
		tabList,
		tabs.map((tab) => tab.button),
	);

	let selection: string | null = null;
	let notifying = false;
	let destroyed = false;

	const find = (id: string): MountedTab | undefined =>
		tabs.find((tab) => tab.id === id);

	const applyState = (): void => {
		for (const tab of tabs) {
			const active = tab.id === selection;
			tab.button.hidden = !tab.available;
			tab.button.setAttribute("aria-expanded", active ? "true" : "false");
			tab.panel.hidden = !active;
		}
		root.classList.toggle("tabsdown--collapsed", selection === null);
		separators.refresh();
	};

	// Committed before the callback runs, so a handler that calls back in sees
	// settled state; the guard then keeps that call from notifying again.
	const commit = (next: string | null, notify: boolean): void => {
		const previous = selection;
		if (next === previous) return;
		const from = panelsEl.getBoundingClientRect().height;
		const outgoing = previous === null ? undefined : find(previous);
		const activeElement = outgoing ? activeElementNear(outgoing.panel) : null;
		if (
			activeElement &&
			outgoing &&
			isShadowIncludingAncestor(outgoing.panel, activeElement)
		) {
			(next === null ? root : (find(next)?.button ?? root)).focus();
		}
		selection = next;
		applyState();
		height.switched(from);
		if (!notify || notifying) return;
		notifying = true;
		try {
			options.onSelectionChange?.(selection, previous);
		} finally {
			notifying = false;
		}
	};

	const onClick = (event: Event): void => {
		const target = event.target;
		if (!(target instanceof ElementConstructor)) return;
		const button = target.closest("button");
		const tab = tabs.find((candidate) => candidate.button === button);
		if (!tab || !tab.available) return;
		commit(tab.id === selection ? null : tab.id, true);
	};

	tabList.addEventListener("click", onClick);

	const initial = options.selection ?? null;
	selection = initial !== null && find(initial) ? initial : null;
	applyState();

	const focusedTab = tabs.find((tab) => tab.panel === focusedSpec?.panel);
	if (focusedTab && focusedElement) {
		(selection === focusedTab.id
			? (focusedElement as HTMLElement)
			: focusedTab.button
		).focus();
	}

	return {
		get selection(): string | null {
			return selection;
		},

		setSelection(id: string | null): void {
			if (destroyed) return;
			if (id === null) {
				commit(null, false);
				return;
			}
			const tab = find(id);
			if (!tab?.available) return;
			commit(id, false);
		},

		setAvailable(id: string, available: boolean): void {
			if (destroyed) return;
			const tab = find(id);
			if (!tab || tab.available === available) return;
			tab.available = available;
			if (available) {
				applyState();
				return;
			}
			// The button is about to disappear; leaving focus on it drops
			// the user at the top of the document.
			if (activeElementNear(tab.button) === tab.button) {
				const index = tabs.indexOf(tab);
				const next =
					tabs.find(
						(candidate, candidateIndex) =>
							candidateIndex > index && candidate.available,
					) ??
					tabs.find(
						(candidate, candidateIndex) =>
							candidateIndex < index && candidate.available,
					);
				(next?.button ?? root).focus();
			}
			if (selection === id) {
				commit(null, true);
			} else {
				applyState();
			}
		},

		destroy(): void {
			if (destroyed) return;
			destroyed = true;
			height.destroy();
			separators.destroy();
			tabList.removeEventListener("click", onClick);
			for (const tab of tabs) {
				mountedPanels.delete(tab.panel);
				for (const [name, value] of tab.restore) {
					if (value === null) {
						tab.panel.removeAttribute(name);
					} else {
						tab.panel.setAttribute(name, value);
					}
				}
				if (!tab.hadPanelClass) {
					tab.panel.classList.remove("tabsdown__panel");
				}
				container.append(tab.panel);
			}
			root.remove();
		},
	};
}
