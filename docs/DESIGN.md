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
| `--plate` | Collection ground, warm paper with a faint dot lattice |
| `--ink`, `--ink-2`, `--ink-3` | Text and lines, three strengths |
| `--hair` | 1 px rules and borders |
| `--rose`, `--magenta`, `--ultramarine` | Contour ramp: flat, hollow, ridge |
| `--signal` | Live feedback only: fingertips, rings, progress |
| `--trait-*` | One hue per trait, used for ligaments and trait bars |

Type scale: 10 / 11.5 / 13 / 15 / 30 px, display `clamp(44px, 5vw, 72px)` at weight 500 with tight tracking.

## Components

- **Buttons**: pill shaped. Primary is solid ink; ghost is a hairline.
- **Tool list**: line glyph and name. The hand pose or key shows on hover or when active.
- **Hand overlay**: joints as small open circles, bones as hairlines, and dimension lines with millimetre lengths during calibration. Engaged fingertips fill with signal and pulse.
- **Inspector**: soft translucent panel with the name, form number, trait bars and relatives with their kinship percentage.
- **Ligaments**: three thin strands, one stronger. They grow in when created and fade back when another form is in focus.

## Materials

Four materials, one data model. Each reads curvature (hollow to ridge), compression (stretched to pressed) and heat (recent touch) in its own way.

| Material | Look | How data shows |
|---|---|---|
| Pearl | Iridescent thin film over a soft pale body, studio reflections | Hue shifts with angle; hollows run warm, ridges cool, pressed areas shift the film |
| Obsidian | Black glass, sharp highlights | Pressed areas carry a deep violet; ridges catch a blue sheen |
| Graphic | Bold smooth colour field, ultramarine through magenta to coral | Position on the ramp is curvature minus pressure |
| Lines | The original contour drawing | Line colour is curvature, line density is compression |

The particle skin is part of each language: full in Lines, a fine pale dust on Pearl and Obsidian, absent on Graphic. The brush appears as one crisp outline on the surface.

## Motion

Slow and physical. Ease-out curves, nothing snaps. Forms grow in over about 1 s, kept forms dissolve toward the collection, and ligaments draw themselves.
