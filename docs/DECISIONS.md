# Decisions

A running log of choices and changes. Newest first.

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
