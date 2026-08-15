export type TabPosition = "top" | "left" | "right" | "bottom";
export type TabLayout = "one" | "multi";
export type TabConfiguration = TabPosition | TabLayout;
export type TabDensity = "default" | "compact";
export type TabPersonality = "button" | "underline" | "separator" | "rail";
export type TabPalette = "primary" | "secondary";
export type TabAlignment = "start" | "center" | "equal-width";

export interface TabsdownConfig {
	position?: TabPosition;
	layout?: TabLayout;
	density?: TabDensity;
	personality?: TabPersonality;
	palette?: TabPalette;
	alignment?: TabAlignment;
}

export type KeyedConfigName =
	| "density"
	| "personality"
	| "palette"
	| "alignment";

export type ParsedConfigToken =
	| { kind: "bare"; value: TabConfiguration }
	| { kind: "keyed"; key: KeyedConfigName; value: string }
	| { kind: "invalid" };

const bareValues = new Set<TabConfiguration>([
	"top",
	"left",
	"right",
	"bottom",
	"one",
	"multi",
]);
const keyedValues: Record<KeyedConfigName, ReadonlySet<string>> = {
	density: new Set(["default", "compact"]),
	personality: new Set(["button", "underline", "separator", "rail"]),
	palette: new Set(["primary", "secondary"]),
	alignment: new Set(["start", "center", "equal-width"]),
};

export function parseConfigToken(token: string): ParsedConfigToken {
	if (bareValues.has(token as TabConfiguration)) {
		return { kind: "bare", value: token as TabConfiguration };
	}

	const match = /^([a-z-]+)=([^=]+)$/.exec(token);
	if (!match) return { kind: "invalid" };
	const key = match[1] as KeyedConfigName;
	const value = match[2] ?? "";
	if (!Object.prototype.hasOwnProperty.call(keyedValues, key)) return { kind: "invalid" };
	if (!keyedValues[key].has(value)) {
		return { kind: "invalid" };
	}
	return { kind: "keyed", key, value };
}

export function serializeConfig(config: TabsdownConfig): string {
	const values = [
		config.position,
		config.layout,
		config.density && `density=${config.density}`,
		config.personality && `personality=${config.personality}`,
		config.palette && `palette=${config.palette}`,
		config.alignment && `alignment=${config.alignment}`,
	].filter(Boolean);
	return values.length === 0 ? "" : `config: ${values.join(", ")}`;
}

export interface ConfigEdit {
	from: number;
	to: number;
	replacement: string;
}

export function configEdit(
	source: string,
	config: TabsdownConfig,
): ConfigEdit {
	const lines = [...source.matchAll(/.*(?:\r\n|\n|$)/g)].filter(
		(match) => match[0] !== "",
	);
	const configLines = [] as RegExpMatchArray[];
	for (const line of lines) {
		if (line[0].startsWith("config:")) {
			configLines.push(line);
			continue;
		}
		if (line[0].trim() !== "") break;
	}
	const newline = source.match(/\r\n|\n/)?.[0] ?? "\n";
	const serialized = serializeConfig(config);
	if (configLines.length === 0) {
		return { from: 0, to: 0, replacement: serialized ? `${serialized}${newline}` : "" };
	}

	const first = configLines[0];
	const last = configLines[configLines.length - 1];
	if (!first || !last || first.index === undefined || last.index === undefined) {
		throw new Error("Unable to locate configuration region.");
	}
	const lastText = last[0];
	const ending = lastText.endsWith("\r\n") ? "\r\n" : lastText.endsWith("\n") ? "\n" : "";
	return {
		from: first.index,
		to: last.index + lastText.length,
		replacement: serialized ? `${serialized}${ending}` : "",
	};
}
