# Templater recipes

[Templater](https://github.com/SilentVoid13/Templater) expands a template into ordinary Markdown first. Tabsdown then renders the resulting fenced `tabsdown` block through Obsidian. Tabsdown does not detect Templater, call its API at runtime, require a load order, or execute unexpanded Templater expressions.

These recipes use Templater's documented JavaScript execution command, output variable `tR`, and [`tp.system.prompt`](https://silentvoid13.github.io/Templater/internal-functions/internal-modules/system-module.html).

## Static template

Save this as a Templater template file:

~~~~markdown
````tabsdown
tab: Overview

Write the overview here.

tab: Example

```text
Nested fenced content is safe because the outer fence is longer.
```
````
~~~~

Use an outer fence longer than every fence in a tab body. Four backticks are enough for nested three-backtick blocks; use five outside if a body contains four consecutive backticks.

## Prompt-driven template

This template asks for comma-separated labels, then prompts for each body with a multiline field. It rejects fewer than two unique, non-empty labels. Canceling any prompt produces no partial `tabsdown` block.

The template measures every run of backticks in the generated source and makes the outer fence one character longer, with a minimum of four backticks.

~~~~markdown
<%*
const labelsInput = await tp.system.prompt(
	"Tab labels, separated by commas",
	"Overview, Details",
	false,
	false,
	true,
);

if (labelsInput !== null) {
	const labels = labelsInput
		.split(",")
		.map((label) => label.trim())
		.filter(Boolean);
	const uniqueLabels = [...new Set(labels)];

	if (labels.length >= 2 && uniqueLabels.length === labels.length) {
		const tabs = [];
		let cancelled = false;

		for (const label of labels) {
			const body = await tp.system.prompt(
				`Markdown for "${label}"`,
				"",
				false,
				true,
			);

			if (body === null) {
				cancelled = true;
				break;
			}

			tabs.push(`tab: ${label}\n\n${body}`);
		}

		if (!cancelled) {
			const source = tabs.join("\n\n");
			const runs = source.match(/`+/g) ?? [];
			const longest = runs.reduce(
				(maximum, run) => Math.max(maximum, run.length),
				3,
			);
			const fence = "`".repeat(longest + 1);
			tR += `${fence}tabsdown\n${source}\n${fence}`;
		}
	}
}
%>
~~~~

`throw_on_cancel` is `false` in every prompt, so Templater returns `null` on cancellation. The template checks that value before appending to `tR`; partially collected labels or bodies are not inserted.

The first prompt is single-line and uses its fifth argument to select the default value. Each body prompt uses the fourth argument to enable multiline input. Labels cannot contain commas in this compact recipe; edit the generated Markdown if a comma is required.

## Using the generated block

1. Insert either template with Templater.
2. Confirm the result is ordinary fenced Markdown with at least two tab markers.
3. Move the cursor outside the block in Live Preview, or open Reading View.

If Templater is disabled or absent, existing generated `tabsdown` Markdown still works. If a template expression remains visible, run Templater or replace the expression manually; Tabsdown intentionally does not evaluate it.
