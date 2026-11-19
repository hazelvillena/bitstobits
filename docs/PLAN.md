# bits to bits: plan

A hand-sculpting tool next to a living collection.
Shape a form with your hands on the left. Forms you keep settle on the right, find their relatives and attach to them, while staying separate objects. Every attachment can say why it exists.

Status: working prototype. See [DECISIONS.md](DECISIONS.md) for what changed and why, and [DESIGN.md](DESIGN.md) for the visual system.

## Experience

1. **Start** (first visit only): a short welcome with Start or Skip, then hands (camera) or mouse. Later visits go straight in, in the last mode used. Switch any time with the Hands/Mouse control in the header (key H); mouse mode turns the camera off. The ? button replays the tips.
2. **Calibrate** (camera, first time or key C): a small card sits beside your hand and follows it. Hold up an open hand; pinch thumb and index fingertips (measures your pinch relative to your palm, and how your index curls); then one practice pull that must reach a good length and be released.
3. **Tour** (first visit): three highlighted tips: the tools, the brush size, and keeping a form. Skippable.
4. **Sculpt**: you start from a smooth rhombicuboctahedron (squares and triangles, softly rounded edges). the current tool's name follows your wrist, so you always know what your hand is doing. The form answers to presence. Rings appear where a fingertip approaches; touched areas glow and cool.
5. **Keep**: press Enter or "Keep this form". The form dissolves toward the collection.
6. **Collection**: every kept form gets a six-digit code (for example 482 913). Switch between the network and a grid of all forms at the top. forms arrange by kinship. Close relatives grow thin ligaments between their nearest surfaces. Hover a form for a small card beside it: a radar chart overlaying its traits on its closest relative's, and how alike they are.

## Tools and gestures

Pick a tool with keys 1 to 4 or the toolbar at the bottom of the sculpt pane. Then **aim and pinch**: your index fingertip points at the form like a mouse cursor, and pinching thumb and index starts the tool exactly where you aimed. Release to stop.

| Key | Tool | While pinched (or mouse held) |
|---|---|---|
| 1 | Extrude | Pull from a face: a clean, rounded taper grows straight out of it, and the form turns so that face points along your pull. It stays turned when you let go. |
| 2 | Spike | Same gesture, a sharp thin needle. |
| 3 | Press | Pull to sink the face into a soft, flat pocket; the form holds still. |
| 4 | Pierce | Hold to bore through; move to carve a groove. |
| 5 | Rotate | Drag anywhere (mouse: right drag). The form never turns on its own. |
| Enter | Keep | |

The outline on the form always marks the face being shaped: it moves with the tip of an extrusion or the floor of a pocket. Every extrusion and pocket remembers its end face; aiming near one snaps to it, so you can continue a piece cleanly.

Starting shapes (Shape menu): Polyhedron (default), Sphere, Cube, Diamond.

Both hands can extrude at the same time. `[` and `]` (or the size control in the toolbar) change the brush size; the surface shows its exact outline. `M` cycles the material. Every tool eases in over a third of a second and is rate-limited, so changes are small and deliberate.

Other keys: `N` start over, `C` recalibrate. Sculpting takes two thirds of the screen by default; drag the divider to resize (double-click to reset). `?layout=rows` stacks them for a portrait screen.

## How it works

**Matter.** A 128³ signed distance field (each point stores its distance to the surface) on the CPU is the source of truth. Brushes edit only the voxels they touch. The GPU gets a half-float copy plus an attribute texture (compression, heat). Rendering is a raymarch in a fragment shader that writes real depth, so the particle skin sorts correctly against it.

**Particle skin.** 56k points with no CPU state. Each frame the vertex shader projects a slowly rotating seed onto the surface, so particles slide over the form and scatter from fingertips.

**Materials.** A dropdown of presets: Lime (default), Iridescent chrome, Opal, Mercury, Ultraviolet, Aqua chrome, Pearl, Obsidian and Lines. Each preset is a five-colour palette plus metal, gloss and iridescence; one shared mapping turns any palette into a finish (see DESIGN.md). Kept forms remember their material.

**Colour as data.**
- Contour line colour follows curvature: rose on flat areas, magenta in hollows, ultramarine on ridges.
- Line density follows compression, so pressed areas draw tighter lines.
- Heat shows recent touch.

**Hands.** MediaPipe Hand Landmarker runs in a module Web Worker on the GPU delegate. Frames are sent only after the previous result returns, so tracking can never queue up behind rendering. A One-Euro filter smooths each landmark. Pinch is measured in 3D from MediaPipe's world landmarks and divided by palm width, so it is the same for any hand at any distance; the index finger must also be curled (pointing keeps it straight). It starts after 100 ms below your calibrated start and releases past a wider value. Depth is never used for interaction: the fingertip's screen position is raycast onto the first visible surface, and a pinch acts there. While pinched, hand motion moves the tool in the screen plane.

**Keeping a form.** Surface nets turn the field into a mesh. Seven traits, each 0 to 1:
- openings (genus, from the Euler characteristic)
- sphericity
- elongation (principal axes)
- concavity
- roughness (curvature spread)
- compression
- volume

Forms are stored in IndexedDB.

**Bridges.** Related forms are joined by symbiotic filaments: each form flares a root of its own matter toward its relative, easing into one fine filament that flows in a slow S-curve. Each half wears its own form's material, and a fine band at the middle in the trait colour says why they are joined. Closer kin get a slightly thicker filament. Anchors glide over the surfaces as forms turn.

**Kinship.** A weighted distance between trait vectors becomes a kinship score (0 to 1). Every form links to its closest relative, plus one more if that one is also above 0.62. The hover card overlays all of a form's relatives. The explanation for a link is the trait the two forms share most distinctively against the rest of the collection. Each form keeps up to two relatives.

## Code map

```
src/
  sculpt/    sdf (distance primitives), volume (field, brushes, strokes), sculptor (tools, profiles), seed
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
- [x] Rounded tapered extrusions (sharp spike profile available) and pockets; two hands at once
- [ ] Twist and two-hand squeeze
- [x] Materials: Pearl, Obsidian, Graphic, Lines
- [ ] Export a form (glTF)

## Running

```bash
npm install
npm run dev
```

Open http://localhost:5173 in Chrome. Camera access needs a normal browser tab.

Deploys to Vercel as a static Vite app: `npm run build` (which first copies the MediaPipe runtime into `public/`) and serve `dist/`.
