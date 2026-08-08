import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig(
	globalIgnores([
		".omx",
		"demo/**/plugins/**",
		"main.js",
		"node_modules",
		"package-lock.json",
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						"eslint.config.mts",
						"esbuild.config.mjs",
						"scripts/*.mjs",
					],
				},
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		files: [
			"esbuild.config.mjs",
			"scripts/**/*.mjs",
			"tests/**/*.ts",
			"vitest.config.ts",
		],
		rules: {
			"obsidianmd/no-nodejs-modules": "off",
			"obsidianmd/hardcoded-config-path": "off",
			// A test setting up a custom property is arranging state, not styling UI.
			"obsidianmd/no-static-styles-assignment": "off",
			// Cascade tests need an in-memory stylesheet; production CSS stays in styles.css.
			"obsidianmd/no-forbidden-elements": "off",
		},
	},
	{
		// The Quartz port vendors tabs.ts verbatim, where Obsidian's DOM
		// extensions do not exist.
		files: ["src/label.ts", "src/tabs.ts", "tests/**/*.ts"],
		rules: {
			// Tests build DOM in jsdom, where Obsidian's createEl helpers do not exist.
			"obsidianmd/prefer-create-el": "off",
		},
	},
);
