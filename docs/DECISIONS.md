# Decisions

A running log of choices and changes. Newest first.

## 2026-11-18 (pinch, calibration, Press, tour, silver)

**Pinch is measured in 3D.** One finger could extrude because the pinch was the on-screen thumb to index distance, which looks small when pointing. Now the worker sends the 3D distance from MediaPipe's world landmarks (metres). A pinch starts after 80 ms below a calibrated start distance and releases past a wider one, following Meta's start and stop thresholds and Ultraleap's hysteresis guidance.

**Calibration follows the hand.** A small card beside the hand: open hand (palm size and resting spread), pinch (your own pinch distance, setting start and release), then one practice pull on the form. The ring's centre dot turns lime the moment the hand is seen.

**Smooth removed, Press added.** Smooth barely changed the shape. Press sinks the grabbed face into a soft, flat pocket whose depth follows the drag; the form holds still.

**The outline marks the grabbed face.** It moved with the aim point, so after the form turned it sat on the wrong face. It now tracks the stroke itself: the tip of an extrusion, the floor of a pocket.

**Tour.** Three highlighted tips after choosing how to sculpt (after calibration with hands): tools, brush size, keeping a form.

**Silver grey.** Both grounds are silver grey with a soft, seamless vignette of the same grey; the collection is a touch deeper.

**Fixes.** Shortcut guard no longer throws for window-level key events; the toolbar collapses to icons in narrower panes.

## 2026-11-18 (connections join the body)

**Connections start at the body, not at spike tips.** Anchors used the surface points reaching furthest toward the other form; on spiky forms those were spike tips, or an average of several tips floating in empty space. Now each end sits on the line between the two forms' centres, at the body's own surface: among surface points in a narrow cone around that line, a low-percentile distance from the centre, which ignores spikes reaching past the body and openings dipping into it. The flared root sits inside the body, so every connection grows out of its form.

## 2026-11-18 (long extrusions, calmer links, fuller samples)

**Long extrusions no longer break.** Rays grazing along a long, thin extrusion ran out of raymarch steps and were discarded, which read as a slice with a floating tip. The march now has more steps, slightly longer strides, and counts a ray that ends very close to the surface as a hit.

**Connections are structured.** No sway; both ends align with the line between the two forms, the middle keeps a steady thickness, and the roots still flare softly from each surface. Calm and diagrammatic, still soft.

**Fuller samples.** All four families, four forms each (16), slightly smaller so they fit.

**Small UI.** The brush size is a field you can type into (5 to 28, Enter to apply; shortcuts are ignored while typing). Buttons and the toolbar have more padding. The collection shows only a count marker.

## 2026-11-18 (codes, welcome, grid, samples)

**Codes instead of names.** Every kept form gets a six-digit code, shown as two groups (482 913). Older saves derive a stable code from their id.

**Welcome.** A small modal explains the app in two sentences with one Start button, then offers hands or mouse as two cards with Lucide icons. Favicon: a lime polyhedron (`public/favicon.svg`).

**Sculpting gets two thirds.** The default split is 2/3; the saved split key changed so the new default applies.

**Hover no longer jitters.** Hover is sticky (it takes a clear move away to let go), and the form in focus stops drifting and turning.

**Richer samples.** "Add samples" makes three families of three: urchins (spikes, chrome or ultraviolet), coral (curved rounded extrusions, lime or opal), porous forms (bored through, mercury, obsidian or aqua) and buds (large lobes, pearl, opal or lime). Built with the same stroke API as the tools.

**Grid view.** A switch at the top of the collection shows every form as a card with a still render (one small offscreen renderer, cached), its code and material.

**Calmer calibration and a finer hand.** One longer hold (2.4 s), a smoothly easing ring that forgives slips, crossfading text and a soft exit. The hand drawing is finer and eases toward each frame.

**Sleeker buttons.** 28 px tall, 14 px padding.

**Fix.** A style cleanup had removed the empty-state and hover card base rules; restored.

## 2026-11-18 (materials system, turning extrude, polyhedron)

**Clicks on the UI were being swallowed.** Mouse sculpting captured the pointer on the whole sculpt pane, so real clicks on the material switch and toolbar never reached them. Sculpting now listens on the canvas only.

**Materials are palettes.** Replaced four hand-written shading branches with one model fed by data: a five-colour palette plus metal, gloss and iridescence. Nine presets in a dropdown; Lime is the default. Older saves map `graphic` to Lime.

**Extrude turns the form toward the pull.** The extrusion grows straight out of the grabbed face; while pulling, the form rotates (eased, about half a second) so that face points along the pull, and stays there. With two hands extruding, the form holds still. Extrusions stop before the edge of the sculpting volume, so they are never sliced flat or torn.

**Spike is its own tool** (key 2), a near-straight cone to a fine point. Extrude stays rounded.

**Starting form: a smooth rhombicuboctahedron.** Built as the soft maximum of its 26 face planes, so faces stay flat and edges softly rounded.

**Bridges stay attached.** Anchors are eased in each form's own space and carried by it, instead of eased in world space where they lagged behind. Growth thickens the whole bridge from a hairline instead of cutting out its middle. The on-canvas connection labels are gone; the hover card explains links.

**Hover card is a radar.** One chart overlays the form's traits on its closest relative's, so the overlap reads at a glance, with generous padding.

**Design system pass.** Motion tokens (three durations, three curves), a shared popover surface, a sliding tool pill, an animated numeric brush size, anti-aliased silhouettes and a resolution that recovers when frames are fast.

## 2026-11-18 (rounded default, hover card)

**Rounded extrusions by default.** The needle was too sharp as the everyday behaviour. The default profile (`ROUNDED`) tapers gently to a soft round tip, and pressing in makes a rounded pocket. The sharp `SPIKE` profile is kept in `sculptor.ts`. The tool is called Extrude again.

**Hover is a card beside the form.** Instead of a panel in the corner, a compact card appears next to the hovered form, flips to the other side near edges and eases along as the form drifts.

## 2026-11-18 (spikes, filaments, warm gray)

**Extrude becomes Spike.** Round-ended tubes read as blunt and unintended. Strokes are now tapered sweeps: round cones along a curve, from the full brush at the root to a fine tip, with a soft fillet into the body. Dragging the other way punctures a tapered hole. Profiles (`SPIKE`, `PUNCTURE` in `sculptor.ts`) are plain data, so new stroke shapes are a few numbers.

**Reusable distance primitives.** `src/sculpt/sdf.ts` holds smooth min/max, capsule, round cone, sweep and bounds. The volume composes generic `StrokeShape`s (path, radii, sign, blend) and knows nothing about specific tools.

**No orbit cage.** The wire icosahedron around the form is gone.

**Filament bridges.** The lobes were too thick and the anchors jumped between mesh vertices, so bridges looked heavy and jittery. Now a flared root eases into one fine filament with a slow S-curve. Anchors are a weighted average of the surface points facing each other and are eased over time, so they glide. Shape constants are in `BRIDGE`.

**Warm gray collection.** New `--field` token (#dcd8d1); kept forms and bridges fade toward it when out of focus. Obsidian no longer has a particle dust.

## 2026-11-18 (two hands, toolbar, symbiosis)

**Rotation only on purpose.** Removed the slow idle spin that started whenever no tool was acting; it read as the form turning under a pointing finger. The form now turns only with Rotate (pinch and drag, or right drag).

**Two hands can extrude at once.** Extrude strokes share one session: a snapshot taken when the first stroke begins, with every active stroke replayed onto it once per frame, only over the areas live strokes have touched. Two simultaneous extrusions run at about 9 ms a frame. When the classifier labels both hands the same, identity falls back to which side of the image each hand is on.

**Higher-definition extrude.** The grid is now 128³. Extrusions are one seamless swept tube ending in a flat, softly rounded face, with a tighter fillet into the body, instead of a chain of rounded pieces that read as blobby and ribbed.

**Toolbar.** Tools are buttons at the bottom of the sculpt pane, with a brush size control. Keys still work. The intro no longer mentions video.

**Graphic is lime.** Deep green through lime to pale chartreuse.

**Symbiotic bridges replace line ligaments.** Lines were abstract. Now related forms extend lobes of their own matter toward each other and meet in a narrow waist, so the connection looks like part of their shape. Each side wears its form's material; a fine band in the trait colour at the waist keeps the reason visible. Related forms sit closer, and each keeps at most two relatives.

## 2026-11-18 (careful tools, real materials)

**Interactions are gentle and intentional.** Feedback: tools were too brute. Every tool now eases in over 0.35 s and works at a slow, fixed rate. The brush is smaller and adjustable (`[` `]`), and a crisp outline on the surface shows exactly what it will touch.

**Extrude replaces Pull and Press.** Pull dragged a point, which made pointy tendrils, and Press cut a large sphere every frame. Extrude grabs a round face (flat centre, rounded edge) and moves it along its own normal, like extruding a face in a SubD modeller. The drag is read in the face's terms: along its on-screen outward direction extrudes, against it insets into a flat-bottomed pocket, and sideways bends the extrusion along a curve whose end face turns to the direction of travel. It is rebuilt from a snapshot taken at the start of the stroke, so moving back undoes it and nothing accumulates.

**Rotate is direct.** It used to add velocity on every frame, so small motions built into large spins. Now the form turns exactly with the hand, with a small dead zone against tremor and a short glide after release.

**Materials replace the default contour look.** Pearl, Obsidian, Graphic and Lines share one shading module, used by both the raymarched form and the kept meshes. Kept forms store their material.

**Kept-form stripes fixed.** The stripes were mesh faces with inconsistent winding being culled. Kept forms now render both sides, and their normals and curvature are smoothed over mesh neighbours.

## 2026-11-18 (aim and pinch)

**Hands aim like a mouse and pinch to act; depth is no longer used.** Inspection showed why touches landed in the wrong place. Depth was estimated from the palm's apparent size, which changes when the hand tilts or the fingers spread. On top of that came MediaPipe's per-landmark z, a learned depth relative to the wrist, not a measured distance. Small errors moved the fingertip through the form, and tools fired wherever the tip ended up, including the hidden back. Now the index fingertip's screen position is raycast onto the first visible surface (the same path as the mouse), a pinch starts the selected tool at that point, and pinch motion drives it in the screen plane with a little gain. This follows the target-then-pinch model of visionOS indirect input. Feedback: a quiet marker on the surface where the tool would land, a ring between thumb and index that closes as you pinch, and a signal dot when the tool is acting.

## 2026-11-18 (simpler onboarding)

**Calibration is a single step.** With tools on keys, the fist and pinch poses had no purpose. Calibration now measures one open hand; the pinch threshold is derived from that hand's own spread.

**No thumbs up.** Keep is Enter or the button. Pinch remains only as the grab for Pull and Rotate.

**Draggable divider.** The line between the panes can be dragged (20 to 80 percent), is remembered, and double-click resets it. The collection camera pulls back in narrow panes so forms keep their spacing.

## 2026-11-18 (tool selection)

**Tools are chosen explicitly, not guessed from hand shape.** Reading the tool from the hand's pose was unreliable: a relaxed, half-curled hand read as a fist, which meant Rotate, so the form kept spinning. Now the person selects a tool with keys 1 to 5 or the tool list. Hands only aim and act. Pierce, Press and Smooth work where the index fingertip touches the form. Pull and Rotate work only while pinching, which acts as a clutch with hysteresis so a grab doesn't drop when fingers flutter. Pose reading is now used only for the thumbs up (keep) and calibration.

## 2026-11-18 (later)

**Pull is now a clay grab.** It used to stamp new material along the path, which felt like a harsh eraser. Now pinching grabs the surface and drags it with a smooth falloff. The move is split into small steps and the grab point travels with the matter, so long pulls become tapered tendrils that stay attached. The grabbed point eases toward the hand, which gives it some weight.

**Keep is a held thumbs up.** Two open palms is a resting pose, so forms were being kept by accident. A thumbs up is deliberate, and any other pose resets the timer.

**More reliable pose reading.** Fingers are judged by how much they bend in 3D, not by tip distance. Bend doesn't change with hand orientation, so switching between tools is more dependable. A 0.3 s latch holds the last tool when a pose blurs mid-gesture.

**Live feedback.** The active tool's name sits under the wrist (dim when hovering, solid when touching), so it's always clear which tool is on.

**Softer edges.** Pierce has a wider blend so holes have rounded rims. The raymarcher takes shorter steps so warped areas render cleanly.

## 2026-11-18

**UI direction: clean and quiet.** Feedback was to remove clutter, tags and anything that looks like generic AI output. Removed registration marks, the north arrow, the scale bar, the fps readout, boxed labels and all-caps text. Dropped the serif display face and use Instrument Sans only. Copy is plain and short ("Keep this form", "Start over", "Collection").

**WebGL2 instead of WebGPU.** The plan proposed WebGPU with TSL compute. For this volume size (96³), CPU brushes that touch only the voxels they reach, plus a full texture upload when something changes, run at 120 fps in testing. WebGL2 avoids TSL's API churn and works in every browser. WebGPU stays an option if the volume needs to grow.

**Distance field on the CPU, raymarched on the GPU.** Brushes stay exact and easy to reason about. The GPU copy is half float, which keeps normals and curvature smooth.

**Stateless particle skin.** Particles are projected onto the surface in the vertex shader each frame, so sculpting never touches particle data.

**Hands in a module worker.** MediaPipe Tasks Vision 1.2.3 supports ES module wasm loading (`forVisionTasks(path, true)`), so it runs in a module worker. The wasm runtime is copied into `public/` at install time. The model loads from Google's model storage.

**Attachments, not merging.** Forms link through thin ligaments between their nearest surfaces and never fuse. Each link records the trait the two forms share most distinctively, which colours the ligament and labels it when in focus. Sharing an absence (both have no openings) is down-weighted as an explanation.

**Contour as the default material.** Taken from the reference plate. Line colour is curvature, line density is compression. Other lenses come later.

**Layout.** Side by side by default, as asked. `?layout=rows` stacks the panes for a portrait display.

**Names.** Forms get plain two-word names from the traits where they depart most from typical values, for example "Hollow ring" or "Long pebble".
