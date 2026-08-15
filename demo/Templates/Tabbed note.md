<%*
const answer = await tp.system.prompt(
	"Tab labels, comma separated (prefix with icon:<lucide-name> for an icon)",
	"icon:pencil Draft, icon:check Final",
);
if (answer === null) return;
const labels = [
	...new Set(
		answer
			.split(",")
			.map((label) => label.trim())
			.filter(Boolean),
	),
];
const position = await tp.system.suggester(
	["top", "left", "right", "bottom"],
	["top", "left", "right", "bottom"],
	false,
	"Tab list position",
);
if (position === null) return;
const layout = await tp.system.suggester(
	["one line", "wrap labels"],
	["one", "multi"],
	false,
	"Tab list layout",
);
if (layout === null) return;

if (labels.length < 2) {
	tR += `> [!warning] Got ${labels.length} unique label(s). A tabsdown block needs at least two.`;
} else {
	tR += "````tabsdown\n" + `config: position=${position}, layout=${layout}\n\n`;
	tR += labels.map((label) => `tab: ${label}\n\n`).join("\n");
	tR += "````";
}
%>
