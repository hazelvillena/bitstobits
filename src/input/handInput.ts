import { Vector3 } from 'three';
import type { Atelier } from '../render/atelier';
import { isStroke, TOOLS, type Sculptor, type ToolKind } from '../sculpt/sculptor';
import type { HandFrame } from './handModel';
import { PinchDetector } from './pinch';
import type { HandTracker } from './handTracker';
import type { PaneMapping } from '../ui/handOverlay';

export interface HandActivity {
  tool: string;
  label: string;
  engaged: boolean;
  /** 0 open … 1 fully pinched, for the closing ring. */
  pinch: number;
  /** Whether the aim currently lands on the form. */
  onForm: boolean;
  /** Length of the stroke in progress (object units), 0 if none. */
  amount: number;
  /** Close but not registering: suggest closing fully. */
  hint: boolean;
  /** Live numbers for the diagnostic view, or null. */
  debug: string[] | null;
}

interface Grab {
  tool: ToolKind;
  /** Screen position of the pinch when it started, and the aim at that moment. */
  startX: number;
  startY: number;
  aimX: number;
  aimY: number;
  /** Distance along the view ray to the grabbed surface (pull). */
  depth: number;
  lastX: number;
  lastY: number;
  held: number;
}

/**
 * Aim, then pinch. The camera gives reliable side-to-side position but
 * unreliable depth, so depth is never used:
 * - Aim: the index fingertip's screen position casts onto the first visible
 *   surface, exactly like the mouse. A tool can only ever land on what you see.
 * - Act: pinching starts the selected tool at that surface point.
 * - Move: while pinched, hand movement drives the tool in the screen plane.
 */
export class HandInput {
  enabled = false;
  tool: () => ToolKind = () => 'extrude';
  activity = new Map<HandFrame, HandActivity>();

  private grabs = new Map<boolean, Grab>();
  private aim = new Map<boolean, { x: number; y: number }>();

  constructor(
    private tracker: HandTracker,
    private atelier: Atelier,
    private sculptor: Sculptor,
    private map: PaneMapping,
  ) {}

  private screen(h: HandFrame, i: number) {
    return { x: this.map.x(h.lm[i * 3]), y: this.map.y(h.lm[i * 3 + 1]) };
  }

  private detectors = new Map<boolean, PinchDetector>();
  /** Show live pinch numbers beside each hand (key D). */
  debug = false;

  private pinchState(h: HandFrame, dt: number) {
    let d = this.detectors.get(h.right);
    if (!d) {
      d = new PinchDetector(this.tracker.cal, () => this.tracker.saveCalibration());
      this.detectors.set(h.right, d);
    }
    return d.update(h, dt);
  }

  /** Per frame. Returns surface markers for the shader. */
  update(dt: number): { tips: { pos: Vector3; strength: number }[] } {
    this.activity.clear();
    if (!this.enabled) return { tips: [] };
    const tips: { pos: Vector3; strength: number }[] = [];
    const selected = this.tool();
    const seen = new Set<boolean>();

    for (const h of this.tracker.hands) {
      const key = h.right;
      seen.add(key);
      const pinch = this.pinchState(h, dt);
      const tip = this.screen(h, 8);
      const mid = { x: (tip.x + this.screen(h, 4).x) / 2, y: (tip.y + this.screen(h, 4).y) / 2 };

      // Aim with the index tip while the hand is open. As the fingers start
      // to close, the tip moves toward the thumb, so the aim locks early and
      // the grab lands where you were pointing.
      if (!pinch.on && pinch.amount < 0.5) this.aim.set(key, tip);
      const aim = this.aim.get(key) ?? tip;

      let grab = this.grabs.get(key);
      // While pinched and not yet holding anything, keep trying to grab: a
      // pinch that starts just off the form still catches it.
      if (pinch.on && !grab) {
        const hit = this.atelier.castSurface(aim.x, aim.y);
        const face = isStroke(selected) && this.sculptor.faceNear(aim.x, aim.y);
        if (selected === 'turn' || hit || face) {
          grab = {
            tool: selected,
            startX: mid.x, startY: mid.y,
            aimX: aim.x, aimY: aim.y,
            depth: hit?.dist ?? 0,
            lastX: mid.x, lastY: mid.y,
            held: 0,
          };
          this.grabs.set(key, grab);
          if (isStroke(selected) && !this.sculptor.beginStroke(String(key), hit, selected, aim)) {
            this.grabs.delete(key);
            grab = undefined;
          }
        }
      }
      if (!pinch.on && grab) {
        this.end(key, grab);
        grab = undefined;
      }

      let engaged = false;
      let onForm = false;
      if (grab) {
        grab.held += dt;
        const ease = Math.min(1, grab.held / 0.35); // tools ease in, never jump
        const dx = mid.x - grab.startX, dy = mid.y - grab.startY;
        if (grab.tool === 'turn') {
          // Direct, calm turning with a small dead zone against tremor.
          let mx = mid.x - grab.lastX, my = mid.y - grab.lastY;
          if (Math.hypot(mx, my) < 1.2) mx = my = 0;
          if (mx || my) this.atelier.rotateBy(mx * 0.0028, my * 0.0028);
          engaged = true;
        } else if (isStroke(grab.tool)) {
          engaged = this.sculptor.dragStroke(String(key), dx, dy, dt);
          // The outline marks the grabbed face itself, wherever it has moved.
          const at = this.sculptor.strokeMarker(String(key));
          if (at) tips.push({ pos: at, strength: 1 });
          onForm = true;
        } else {
          const hit = this.atelier.castSurface(grab.aimX + dx, grab.aimY + dy);
          if (hit) {
            onForm = true;
            engaged = this.sculptor.drill(hit.point, hit.dir, dt, ease);
            tips.push({ pos: hit.point, strength: 1 });
          }
        }
        grab.lastX = mid.x;
        grab.lastY = mid.y;
      } else {
        // Hover: a quiet marker where the tool would land.
        const hit = this.atelier.castSurface(aim.x, aim.y);
        const face = isStroke(selected) ? this.sculptor.faceNear(aim.x, aim.y) : null;
        if (face && !hit) {
          onForm = true;
          tips.push({ pos: this.sculptor.faceWorld(face), strength: 0.35 + 0.5 * pinch.amount });
        } else if (hit) {
          onForm = true;
          const at = isStroke(selected) ? this.sculptor.snapScreen(aim.x, aim.y, hit.point) : hit.point;
          tips.push({ pos: at, strength: 0.35 + 0.5 * pinch.amount });
        }
      }

      this.activity.set(h, {
        tool: grab?.tool ?? selected,
        label: TOOLS.find((t) => t.kind === (grab?.tool ?? selected))!.name,
        engaged,
        pinch: pinch.amount,
        onForm,
        amount: grab && isStroke(grab.tool) ? this.sculptor.strokeAmount(String(key)) : 0,
        hint: pinch.hint,
        debug: this.debug
          ? [
              `3D ${h.pinchRel.toFixed(2)} → ${pinch.c3.toFixed(2)}`,
              `2D ${h.pinchRatio.toFixed(2)} → ${pinch.c2.toFixed(2)}`,
              `curl ${h.indexBend.toFixed(2)}${pinch.pointing ? ' pointing' : ''}`,
              `pinch ${pinch.on ? 'on' : 'off'} at ${pinch.amount.toFixed(2)}`,
            ]
          : null,
      });
    }

    // Hands that left the frame release whatever they held.
    for (const [key, grab] of this.grabs) if (!seen.has(key)) this.end(key, grab);
    return { tips };
  }

  private end(key: boolean, grab: Grab) {
    if (isStroke(grab.tool)) this.sculptor.endStroke(String(key));
    this.grabs.delete(key);
  }
}
