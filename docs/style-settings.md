# Style Settings

Tabsdown works without [Style Settings](https://github.com/mgmeyers/obsidian-style-settings). When it is installed, these controls are available:

| Group | Controls |
| --- | --- |
| General | **Size:** Compact or Default. **Personality:** Button, Underline, Separator, or Rail. **Overflow:** Scroll or Wrap. **Palette:** Primary or Secondary. **Accent:** custom color, or the theme accent when unset. **Alignment:** Start, Center, or Equal width. Defaults: Size = Default, Personality = Rail, Overflow = Scroll, Palette = Primary, Alignment = Equal width. |
| Tab appearance | Optional theme button outline (off by default); corner radius set to Auto (the active theme's small radius) or Custom from 0–24 px (default custom value 4 px); underline thickness from 1–8 px (default 2 px); underline placement of Auto, Top, Right, Bottom, or Left. |
| Layout | Tab gap from 0–48 px (default 4 px); horizontal padding and content spacing from 0–48 px (defaults 36 px and 12 px); horizontal padding is the Default/base value and Compact uses one-third; side-list width from 192–320 px (default 192 px). |
| Icons and labels | Icon size from 12–32 px (default 16 px); icon spacing from 0–16 px (default 6 px); selected-label weight of Thinner (400), Default (600 on wide desktop / native Medium on mobile and narrow viewports), or Bolder (700). |
| Nested blocks | Flat (default) or Card. Nested tabs default to the Secondary palette unless the block overrides it. |
| Motion | Animation speed from 0–500 ms (default 160 ms), plus a toggle to disable animations. Animations are enabled by default. |

## Position overrides

Top, Bottom, Left, and Right can each override personality, palette, and alignment. Top and Bottom inherit Rail by default; Left and Right default to Underline. **Inherit defaults** restores the global choice. These overrides apply to fenced Markdown blocks; tabs created with `mountTabs` use the global settings.

An authored block can override position, overflow, density, personality, palette, and alignment directly from the matching right-click submenu. The current choice is checked and changes save immediately, and each **Inherit** entry names the value it currently resolves to. The cascade is block override → automatic mobile or narrow Compact density → position override → global setting → built-in fallback. Nested blocks resolve independently, and `mountTabs` uses global appearance settings with automatic mobile sizing.

## Behavior notes

- Underline Auto uses the bottom edge for Top, Bottom, and mounted controls, the right edge for Left, and the left edge for Right.
- Corner radius defaults to Auto and follows the active theme. Custom applies the slider value to the outside corners of each Button row and column, and to the Rail track. Each Rail tab uses the track radius minus its inset padding, clamped at zero, so the corners keep even spacing in both density modes. Adjacent Button corners keep the theme's default radius. Underline and Separator tabs remain square.
- Left and Right tabs always fill their side list on wide layouts and become an equal-width row above the content in narrow containers; Alignment positions the list without changing that structural sizing. Equal width with Wrap keeps complete rows aligned and expands the final row.
- An unconfigured authored block is always Compact on mobile and also becomes Compact when its own container is 28rem wide or narrower, including split panes on desktop. Compact reduces both tab padding and the Rail track padding. Explicit Default and Compact choices do not change with device or width.
- Tabs created with `mountTabs` also become Compact on mobile and in viewports 28rem wide or narrower. Their live panels keep their original containing block, including fixed-position overlays.
- Mobile labels use the theme’s compact UI font (`--font-ui-smaller`, about 13px at default mobile settings) and Medium selection weight. They follow Obsidian’s preferred text scale; authored bold labels and explicit Thinner/Bolder preferences are preserved. Wide desktop labels keep `--font-ui-small`.
- Automatic mobile spacing uses half the horizontal-padding setting (18px with the default 36px setting). Explicit Default and Compact densities keep their own padding.
- Touch/coarse-pointer tabs retain at least 44 × 44 px targets across every personality. Rail removes extra vertical track padding for a 44px total minimum height and grows when larger text needs room.
- Theme colors, focus styles, and reduced-motion behavior still come from Obsidian.

## Mobile sizing references

Obsidian recommends UI font variables for controls in its [typography reference](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Reference/CSS%20variables/Foundations/Typography.md), and [mobile text scaling](https://obsidian.md/changelog/2026-10-05-mobile-v1.14.4/) combines the note font size with the system’s preferred scale. The compact label role is a Tabsdown choice, rather than a published Obsidian segmented-control specification. Installed Obsidian 1.15.0 CSS uses `--font-ui-smaller` for mobile tab preview titles, Medium weight for mobile buttons, and `--touch-size-m` (44px) for native input height. The smaller UI token is approximately 12.8px at a 16px base and scale 1, and remains responsive to theme and accessibility settings.
