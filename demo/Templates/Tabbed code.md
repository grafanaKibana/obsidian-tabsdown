<%*
const answer = await tp.system.prompt("Languages, comma separated", "python, javascript");
if (answer === null) return;
const languages = [
	...new Set(
		answer
			.split(",")
			.map((language) => language.trim())
			.filter(Boolean),
	),
];

if (languages.length < 2) {
	tR += `> [!warning] Got ${languages.length} unique language(s). A tabsdown block needs at least two.`;
} else {
	tR += "````tabsdown\nconfig: position=top, layout=one\n\n";
	tR += languages
		.map(
			(language) =>
				`tab: icon:code ${language}\n\n` + "```" + `${language}\n\n` + "```\n",
		)
		.join("\n");
	tR += "````";
}
%>
