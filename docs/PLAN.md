# bits to bits — Plan

A hand-sculpting instrument and a living specimen field.
You shape a substance with your bare hands on the left; finished specimens settle on the right, where they find their relatives and **attach** (never fuse) for reasons the viewer can read.

Status: **planning** · POC, local browser, single user, no accounts.

---

## 1. Experience

```
┌──────────────────────────┬──────────────────────────┐
│  ATELIER  (left)         │  FIELD  (right)          │
│                          │                          │
│  calibrate → sculpt →    │  specimens drift, find   │
│  accept                  │  kin, grow ligaments     │
│                          │  labelled with "why"     │
└──────────────────────────┴──────────────────────────┘
```

1. **Calibrate** — hand appears as a measured node diagram; three poses (open, fist, pinch) set scale and thresholds.
2. **Sculpt** — a mass of matter floats in the atelier. Hands deform it like clay. Color is data: it shows how the form was made.
3. **Accept** — hold both palms open ~1.5s. The specimen crystallises, receives an ID and a measurement sheet, and travels to the field.
4. **Field** — specimens arrange by similarity. Close relatives grow thin **ligaments** between their nearest surfaces. Each ligament carries a label naming the shared traits that caused it.

---

## 2. Matter model

**Signed distance field (SDF) volume = truth. Particles = skin.**

- Shape: 128³ SDF in a 3D storage texture, edited by GPU compute brushes (smooth-union add, smooth-subtract carve, blur smooth, displace pull/twist).
- Attribute channels stored per voxel alongside the SDF:
  | Channel | Meaning | Written by |
  |---|---|---|
  | `compression` | pressed vs stretched | press, squeeze, pull |
  | `heat` | recency of touch, decays | every brush |
  | `curvature` | convex vs concave | derived from SDF |
  | `thickness` | local wall thickness | derived |
- Skin: ~150k GPU particles attracted to the iso-surface, sliding along it, scattering on contact. Particle density follows `compression`.

### Material — Contour (default)
Topographic drawing language from the reference plate:
- Iso-lines sliced through the form (horizontal + view-aligned), fine hairline weight.
- Line color mapped across a rose → magenta → ultramarine ramp by curvature; line density by compression; heat as a faint glow on fresh touches.
- Thin surface shell underneath (pale, slightly translucent) so the form reads as solid.
- Optional secondary lenses kept behind a toggle for later: Obsidian, Bioluminescent, Particle.

---

## 3. Hand interaction

**Tracking:** MediaPipe Hand Landmarker (`@mediapipe/tasks-vision`), GPU delegate, in a Web Worker. 21 landmarks × 2 hands. One-Euro filter per landmark. Depth from palm span (calibrated) + relative landmark z.

**Calibration screen — "measurement plate"**
- 21 joints rendered as nodes with true anatomical labels (CMC, MCP, PIP, DIP, TIP) set in small caps.
- Dimension lines measure each finger segment live, like an architectural drawing (values in mm-estimate).
- Three target poses shown as outline glyphs; each fills with a radial progress ring as you hold it.
- Result card: hand span, finger ratios, pinch threshold — the user's "hand signature".

**Gestures**
| Gesture | Tool |
|---|---|
| Index pushes in | **Poke / drill** — capsule subtraction along fingertip path |
| Pinch + pull | **Pull** — draws a neck / tendril |
| Flat palm press | **Press** — flattens, raises compression |
| Palm hover + stroke | **Smooth** |
| Two hands close in | **Squeeze** — global compression |
| Pinch + wrist roll | **Twist** |
| Off-hand fist | **Turntable** — rotate the object |
| Both palms open, hold | **Accept** |

Contact feedback: surface warms and dimples *before* contact (proximity field), compensating for weak monocular depth.

---

## 4. Field — similarity and attachment

**Specimen signature** (computed on accept, normalised 0–1):
volume · surface area · sphericity · elongation (PCA ratio) · genus (hole count) · mean |curvature| · concavity ratio · roughness · mean compression · color centroid.

**Behaviour**
- 3D force layout: attraction ∝ similarity, soft repulsion for all, gentle drift.
- **Ligaments** form when similarity > threshold. They grow from each specimen's nearest surface points, as thin tensile struts with small nodes — never a smooth union. Each specimen keeps its own body.
- **Explainability:** each ligament is colored by its dominant shared trait and labelled with a leader line, e.g. `genus 3 ↔ 3 · sphericity 0.71 ↔ 0.68`. Hovering a specimen shows its radar of traits and its top 3 kin with match %.
- Clusters get a faint enclosing contour and a generated name (`Cluster B · porous · 4`).

---

## 5. Design system

**Direction:** a scientific plate, not an app. Paper, hairlines, annotations, dimensions. No black void, no floating GUI panels — information lives in the drawing as callouts and margins.

**Type** (both OFL, Google Fonts, no italics, no mono)
- **Instrument Serif** — display: specimen names, section titles.
- **Instrument Sans** (variable, width axis) — UI, labels, data. Numerals use `tabular-nums` in place of mono.
- Small caps + letter-spacing for anatomical/technical labels.

**Color tokens**
| Token | Use | Value (draft) |
|---|---|---|
| `paper` | atelier ground, misty gradient | `#E9ECEF → #C9D1D8` |
| `plate` | field ground, faint grid | `#F4F2EE` |
| `ink` | text, hairlines | `#1C2228` |
| `ink-soft` | secondary text, grid | `#1C2228 @ 45% / 12%` |
| `rose` / `magenta` / `ultramarine` | contour ramp | `#F2A6C8` / `#D6247A` / `#3A3FD1` |
| `signal` | live nodes, active ligaments | `#B9C93A` (chartreuse wire from ref 1) |

**Elements:** hairline rules (0.5–1px), registration marks in corners, scale bar, north arrow, leader-line callouts, plate numbers, specimen cards like herbarium sheets.

**Motion:** slow, physical easing; nothing snaps. Ligaments grow with a drawn-line stroke; accepted specimens travel across the split along an arc.

**Code:** tokens in one `tokens.css` (CSS custom properties) mirrored to a `tokens.ts` for shaders; UI as small vanilla TS components; no UI framework needed for the POC.

---

## 6. Architecture

```
src/
  input/       hand worker, filters, calibration, gesture → Tool events
  sculpt/      SDF volume, compute brushes, attribute channels
  render/      contour material, particle skin, scene/cameras
  specimen/    signature extraction, mesh bake, serialization
  field/       force layout, similarity, ligaments, labels
  ui/          design tokens, plate chrome, callouts, cards
  app/         state machine: calibrate → sculpt → accept → field
```

- Stack: Vite + TypeScript, Three.js (pinned) WebGPU renderer + TSL, WebGL2 fallback.
- Input is abstract: gestures emit `Tool` events, so mouse (debug), depth cameras or VR can drive the same sculptor.
- Only the active specimen is raymarched/full quality; accepted specimens are baked to meshes (marching cubes) so the field scales.
- Persistence: IndexedDB (specimens as compressed 64³ volumes + signature). Reset button for demos.
- Layout: one page, two halves. Built for a portrait display but responsive to a landscape laptop for testing.

---

## 7. Milestones

1. **Scaffold** — Vite/TS/Three, tokens, plate chrome, split layout, mouse-driven debug tools.
2. **Hands** — worker tracking, filtering, calibration plate.
3. **Matter** — SDF volume, brushes, Contour material, particle skin.
4. **Gestures** — map hands to tools, contact feedback, accept flow.
5. **Specimens** — signature, bake, card, transfer animation.
6. **Field** — layout, similarity, ligaments with explanations, clusters.
7. **Polish** — motion, performance pass, demo seed specimens.

Each milestone ends runnable in the browser.

---

## References
- Ref 1: obsidian form inside a chartreuse wire cage — line language for ligaments/signal.
- Ref 2: metaballs with glowing rims — contact glow.
- Ref 3: architecture plate (attractor points → field → amalgamation; contour output) — overall plate aesthetic and Contour material.
