# Decisions

A running log of choices and changes. Newest first.

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
