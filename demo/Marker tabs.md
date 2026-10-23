# Marker tabs and in-place editing

Open in Reading View or Live Preview. In Live Preview, click the active body or focus its tab and press Down to edit its Markdown. Switch tabs, use Undo/Redo, and press Escape to return to the note. Source Mode exposes all delimiters.

%% tabs %%
%% tab: icon:map Overview %%
A normal **Markdown** paragraph, a [[Tabsdown test matrix|vault link]], and a list:

- Edit this body in place.
- Select all inside the editor; the rest of the note stays untouched.

%% tab: Details %%
The inactive tab stays mounted while another body is edited.

```javascript
console.log("Marker tabs need no outer code fence.");
```
%% endtabs %%

This paragraph follows the marker block and must remain visible.

## Nested markers, settings, and authoring actions

Use the context menu to change settings or add a tab; double-click a label to rename it. These actions preserve marker syntax.

%% tabs %%
%% config: position=left, personality=rail %%
%% tab: Nested %%
%% tabs %%
%% tab: Inner one %%
Inner Markdown.
%% tab: Inner two %%
Another inner body.
%% endtabs %%
%% tab: Fenced child %%
```tabsdown
tab: Existing syntax
Fenced blocks support the same in-place body editing.
tab: Another tab
Existing notes need no migration.
```
%% endtabs %%

## Fenced parent, marker child

````tabsdown
tab: Mixed formats
%% tabs %%
%% tab: First %%
First nested body.
%% tab: Second %%
Second nested body.
%% endtabs %%
tab: Empty body
````

## Literal markers in a code example

```markdown
%% tabs %%
%% tab: Example one %%
This is code, not another rendered layout.
%% tab: Example two %%
Still code.
%% endtabs %%
```
