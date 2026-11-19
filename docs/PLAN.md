# bits to bits: plan

A hand-sculpting tool next to a living collection.
Shape a form with your hands on the left. Forms you keep settle on the right, find their relatives and attach to them, while staying separate objects. Every attachment can say why it exists.

Status: working prototype. See [DECISIONS.md](DECISIONS.md) for what changed and why, and [DESIGN.md](DESIGN.md) for the visual system.

## Experience

1. **Start**: camera or mouse.
2. **Calibrate** (camera): hold up an open hand for a moment. It appears as a measured diagram of 21 joints with live dimension lines.
3. **Sculpt**: the current tool's name follows your wrist, so you always know what your hand is doing. The form answers to presence. Rings appear where a fingertip approaches; touched areas glow and cool.
4. **Keep**: press Enter or "Keep this form". The form dissolves toward the collection.
5. **Collection**: forms arrange by kinship. Close relatives grow thin ligaments between their nearest surfaces. Hover a form to see its traits, its relatives and the shared trait behind each attachment.

## Tools and gestures

Pick a tool with keys 1 to 5 or by clicking it. Then **aim and pinch**: your index fingertip points at the form like a mouse cursor, and pinching thumb and index starts the tool exactly where you aimed. Release to stop.

| Key | Tool | While pinched (or mouse held) |
|---|---|---|
| 1 | Extrude | Drag along the face's outward direction to extrude it, the other way to inset it. Drag sideways to bend it; the end face turns toward the direction of travel. Moving back undoes, so you can find the right length. |
| 2 | Pierce | Hold to bore slowly; move to carve a groove |
| 3 | Smooth | Move across the surface |
| 4 | Rotate | Drag anywhere (mouse: right drag). The form follows your hand exactly and glides briefly on release. |
| Enter | Keep | |

`[` and `]` change the brush size; the surface shows its exact outline. `M` cycles the material. Every tool eases in over a third of a second and is rate-limited, so changes are small and deliberate.

Other keys: `N` start over, `C` recalibrate. Drag the divider to resize the panes (double-click for an even split). `?layout=rows` stacks them for a portrait screen.

## How it works

**Matter.** A 96³ signed distance field (each point stores its distance to the surface) on the CPU is the source of truth. Brushes edit only the voxels they touch. The GPU gets a half-float copy plus an attribute texture (compression, heat). Rendering is a raymarch in a fragment shader that writes real depth, so the particle skin sorts correctly against it.

**Particle skin.** 56k points with no CPU state. Each frame the vertex shader projects a slowly rotating seed onto the surface, so particles slide over the form and scatter from fingertips.

**Materials.** Pearl (thin-film iridescence), Obsidian (black glass), Graphic (bold colour field) and Lines (the contour drawing). All four read the same data. Kept forms remember their material.

**Colour as data.**
- Contour line colour follows curvature: rose on flat areas, magenta in hollows, ultramarine on ridges.
- Line density follows compression, so pressed areas draw tighter lines.
- Heat shows recent touch.

**Hands.** MediaPipe Hand Landmarker runs in a module Web Worker on the GPU delegate. Frames are sent only after the previous result returns, so tracking can never queue up behind rendering. A One-Euro filter smooths each landmark. Depth is never used for interaction: the fingertip's screen position is raycast onto the first visible surface, and a pinch acts there. While pinched, hand motion moves the tool in the screen plane.

**Keeping a form.** Surface nets turn the field into a mesh. Seven traits, each 0 to 1:
- openings (genus, from the Euler characteristic)
- sphericity
- elongation (principal axes)
- concavity
- roughness (curvature spread)
- compression
- volume

Forms are stored in IndexedDB.

**Kinship.** A weighted distance between trait vectors becomes a kinship score (0 to 1). Each form links to up to 3 relatives above 0.62. The explanation for a link is the trait the two forms share most distinctively against the rest of the collection. Ligaments are three bezier strands between support points on each surface, coloured by that trait.

## Code map

```
src/
  sculpt/    volume (field, brushes), sculptor (tools), seed (starting lumps, samples)
  render/    atelier scene, clay raymarch material, particle skin
  input/     hand worker, tracker, hand model and filters, calibration, hand → tools, pointer
  specimen/  mesher (surface nets), signature (traits, kinship), specimen (naming, storage)
  field/     collection scene, layout, ligaments, specimen material
  ui/        tokens, base styles, chrome, hand overlay
```

## Milestones

- [x] Scaffold, design tokens, split layout
- [x] Clay field, brushes, Contour material, particle skin
- [x] Mouse tools
- [x] Hand tracking worker, calibration, gestures
- [x] Keeping forms: mesh, traits, naming, storage
- [x] Collection: kinship layout, ligaments, hover detail
- [ ] Tune gestures with a real camera session (depth gain, pinch threshold)
- [x] Face extrude with bend and inset
- [ ] Twist and two-hand squeeze
- [x] Materials: Pearl, Obsidian, Graphic, Lines
- [ ] Export a form (glTF)

## Running

```bash
npm install
npm run dev
```

Open http://localhost:5173 in Chrome. Camera access needs a normal browser tab.
