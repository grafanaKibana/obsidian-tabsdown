<%*
const answer = await tp.system.prompt("Folder path", "");
if (answer === null) return;
const folder = answer.replace(/^\/|\/$/g, "");
const matches = app.vault
	.getMarkdownFiles()
	.filter((file) => (folder === "" ? true : file.path.startsWith(`${folder}/`)))
	.filter((file) => file.path !== tp.file.path(true))
	.sort((a, b) => a.basename.localeCompare(b.basename));
const notes = [...new Map(matches.map((file) => [file.basename, file])).values()];

if (notes.length < 2) {
	tR += `> [!warning] Found ${notes.length} note(s) under "${folder}". A tabsdown block needs at least two tabs.`;
} else {
	tR += "````tabsdown\nconfig: position=left, layout=multi\n\n";
	tR += notes
		.map((file) => `tab: icon:file-text ${file.basename}\n\n![[${file.path}]]\n`)
		.join("\n");
	tR += "````";
}
%>
