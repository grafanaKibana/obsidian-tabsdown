# Style Settings

Tabsdown works without [Style Settings](https://github.com/mgmeyers/obsidian-style-settings). When it is installed, these controls are available:

| Group | Controls |
| --- | --- |
| General | **Size:** Compact or Default. **Personality:** Button, Underline, Separator, or Rail. **Overflow:** Scroll or Wrap. **Palette:** Primary or Secondary. **Accent:** custom color, or the theme accent when unset. **Alignment:** Start, Center, or Equal width. Defaults: Size = Default, Personality = Rail, Overflow = Scroll, Palette = Primary, Alignment = Equal width. |
| Tab appearance | Optional theme button outline (off by default); underline thickness from 1–8 px (default 2 px); underline placement of Auto, Top, Right, Bottom, or Left. |
| Layout | Tab gap from 0–48 px (default 4 px); corner radius from 0–24 px (default 4 px); horizontal padding and content spacing from 0–48 px (defaults 36 px and 12 px); side-list width from 192–320 px (default 192 px). |
| Icons and labels | Icon size from 12–32 px (default 16 px); icon spacing from 0–16 px (default 6 px); selected-label weight of Thinner (400), Default (600), or Bolder (700). |
| Nested blocks | Flat (default) or Card. Nested tabs always use the Secondary palette. |
| Motion | Animation speed from 0–500 ms (default 160 ms), plus a toggle to disable animations. Animations are enabled by default. |

## Position overrides

Top, Bottom, Left, and Right can each override personality, palette, and alignment. Top and Bottom inherit Rail by default; Left and Right default to Underline. **Inherit defaults** restores the global choice. These overrides apply to fenced Markdown blocks; tabs created with `mountTabs` use the global settings.

## Behavior notes

- Underline Auto uses the bottom edge for Top, Bottom, and mounted controls, the right edge for Left, and the left edge for Right.
- Left and Right lists move above the content in narrow containers. Equal width with Wrap keeps complete rows aligned and expands the final row.
- Theme colors, focus styles, and reduced-motion behavior still come from Obsidian.
