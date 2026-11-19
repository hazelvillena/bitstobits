# Design system

The page reads like a quiet drawing, not like an app. Hairlines, soft paper and one live accent. Information appears when you look for it and otherwise stays out of the way.

## Rules

- One typeface: **Instrument Sans** (variable weight and width). No serif, no mono, no italics.
- Sentence case everywhere. No all-caps labels.
- No em dashes in copy.
- No boxed tags or pills for data. Labels are plain text; connection labels appear only when a form is in focus.
- Chrome is limited to one line at the top and one at the bottom of each pane.
- Numbers use tabular figures, not a monospace font.

## Tokens

Defined in `src/ui/tokens.css`, mirrored for shaders in `src/ui/tokens.ts`.

| Token | Use |
|---|---|
| `--mist-0 / --mist-1` | Sculpt pane ground, soft vertical gradient |
| `--plate` | Paper for panels and button text |
| `--field` | Collection ground: warm gray with a faint dot lattice |
| `--ink`, `--ink-2`, `--ink-3` | Text and lines, three strengths |
| `--hair` | 1 px rules and borders |
| `--rose`, `--magenta`, `--ultramarine` | Contour ramp: flat, hollow, ridge |
| `--signal` | Live feedback only: fingertips, rings, progress |
| `--trait-*` | One hue per trait, used for ligaments and trait bars |

Type scale: 10 / 11.5 / 13 / 15 / 30 px, display `clamp(44px, 5vw, 72px)` at weight 500 with tight tracking.

## Components

- **Buttons**: pill shaped. Primary is solid ink; ghost is a hairline.
- **Toolbar**: a translucent pill of tool buttons (glyph, name, key). A solid ink pill slides to the selected tool with a slight spring. Beside it, the brush size: minus, a dot that grows, a number that counts to its new value, plus. Hand gestures live in tooltips.
- **Popover**: the one floating surface (`.popover`): warm translucent fill, blur, 14 px radius, a soft two-layer shadow. Used by the material dropdown and the hover card.
- **Material dropdown**: a quiet pill trigger with the current swatch; the list opens with a short spring (scale and fade) and supports arrow keys and Escape.
- **Hand overlay**: joints as small open circles, bones as hairlines, and dimension lines with millimetre lengths during calibration. Engaged fingertips fill with signal and pulse.
- **Hover card**: a popover beside the hovered form (flips side near edges, follows the form) with 20 px padding: the name and form number, one radar chart overlaying the form's traits (ink) on its closest relative's (lime), a two-item legend and how alike they are.
- **Bridges**: a flared root of each form's own matter easing into one fine filament with a slow S-curve, and a fine trait-colour band at the middle. They grow from both sides and recede when another form is in focus. Shape constants live in `BRIDGE` (`src/field/bridge.ts`).

## Materials

A material is data (`src/render/materials.ts`): a five-colour palette, dark to light, plus `metal`, `gloss` and `film` (iridescence). One shading model maps any palette the same way, so a new finish is only a new palette, and later a palette could come from a painting:

- **Body:** the palette, at a position set by the form's own data. Hollows sit darker, ridges lighter, and pressed areas shift down.
- **Reflections:** the palette wrapped around the room, looked up by reflection direction, so metallic finishes mirror their own colours. Three white softboxes are shared by every finish.
- **Iridescence:** slides the reflection lookup with viewing angle and curvature.

| Preset | Palette feel | Metal / gloss / film |
|---|---|---|
| Lime (default) | Deep green to pale chartreuse | Painted, soft, none |
| Iridescent chrome | Indigo, periwinkle, cyan, pink | Mirror, sharp, strong |
| Opal | Milky lilac, mint, peach | Satin, glossy, medium |
| Mercury | Graphite to white | Full mirror, sharp, none |
| Ultraviolet | Deep violet to orchid | Mirror, sharp, medium |
| Aqua chrome | Teal to ice | Mirror, sharp, medium |
| Pearl | Pastel lilac and rose | Satin, medium, strong |
| Obsidian | Near-black to slate | Mirror, very sharp, none |
| Lines | Ultramarine, magenta, rose | The contour drawing |

The particle skin appears only with Lines; finishes stay clean. Silhouettes are anti-aliased in the raymarcher.

## Motion

Three durations (`--t-fast` 160 ms, `--t-med` 280 ms, `--t-slow` 700 ms) and three curves (`--ease-out`, `--ease-soft`, and `--ease-spring` with a hint of overshoot for popovers and the tool pill). Slow and physical; nothing snaps. Forms grow in over about 1 s, kept forms dissolve toward the collection, and ligaments draw themselves.
