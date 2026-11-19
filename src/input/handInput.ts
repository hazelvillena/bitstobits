import { Vector3 } from 'three';
import type { Atelier } from '../render/atelier';
import { ROUNDED, SPIKE, TOOLS, type Sculptor, type ToolKind } from '../sculpt/sculptor';
import type { HandFrame } from './handModel';
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

  private pinching = new Map<boolean, boolean>();
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

  /** Pinch with hysteresis, so a grab doesn't drop when fingers flutter. */
  private pinchState(h: HandFrame) {
    const on = this.tracker.cal.pinchOn;
    const open = on / 0.28; // calibration sets pinchOn ≈ 0.28 × open spread
    const was = this.pinching.get(h.right) ?? false;
    const now = was ? h.pinchRatio < on * 1.45 : h.pinchRatio < on;
    this.pinching.set(h.right, now);
    const amount = Math.min(1, Math.max(0, (open - h.pinchRatio) / (open - on)));
    return { now, started: now && !was, amount };
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
      const pinch = this.pinchState(h);
      const tip = this.screen(h, 8);
      const mid = { x: (tip.x + this.screen(h, 4).x) / 2, y: (tip.y + this.screen(h, 4).y) / 2 };

      // Aim with the index tip while open. Once pinching, the index moves
      // toward the thumb, so freeze the aim and follow the pinch's motion.
      if (!pinch.now) this.aim.set(key, tip);
      const aim = this.aim.get(key) ?? tip;

      let grab = this.grabs.get(key);
      if (pinch.started) {
        const hit = this.atelier.castSurface(aim.x, aim.y);
        if (selected === 'turn' || hit) {
          grab = {
            tool: selected,
            startX: mid.x, startY: mid.y,
            aimX: aim.x, aimY: aim.y,
            depth: hit?.dist ?? 0,
            lastX: mid.x, lastY: mid.y,
            held: 0,
          };
          this.grabs.set(key, grab);
          const shaping = selected === 'extrude' || selected === 'spike';
          if (shaping && hit && !this.sculptor.beginExtrude(String(key), hit, selected === 'spike' ? SPIKE : ROUNDED)) {
            this.grabs.delete(key);
            grab = undefined;
          }
        }
      }
      if (!pinch.now && grab) {
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
        } else if (grab.tool === 'extrude' || grab.tool === 'spike') {
          engaged = this.sculptor.dragExtrude(String(key), dx, dy, dt);
          const hit = this.atelier.castSurface(grab.aimX, grab.aimY);
          if (hit) tips.push({ pos: hit.point, strength: 1 });
          onForm = true;
        } else {
          const hit = this.atelier.castSurface(grab.aimX + dx, grab.aimY + dy);
          if (hit) {
            onForm = true;
            if (grab.tool === 'drill') engaged = this.sculptor.drill(hit.point, hit.dir, dt, ease);
            else engaged = this.sculptor.smooth(hit.point, dt, ease);
            tips.push({ pos: hit.point, strength: 1 });
          }
        }
        grab.lastX = mid.x;
        grab.lastY = mid.y;
      } else {
        // Hover: a quiet marker where the tool would land.
        const hit = this.atelier.castSurface(aim.x, aim.y);
        if (hit) {
          onForm = true;
          tips.push({ pos: hit.point, strength: 0.35 + 0.5 * pinch.amount });
        }
      }

      this.activity.set(h, {
        tool: grab?.tool ?? selected,
        label: TOOLS.find((t) => t.kind === (grab?.tool ?? selected))!.name,
        engaged,
        pinch: pinch.amount,
        onForm,
      });
    }

    // Hands that left the frame release whatever they held.
    for (const [key, grab] of this.grabs) if (!seen.has(key)) this.end(key, grab);
    return { tips };
  }

  private end(key: boolean, grab: Grab) {
    if (grab.tool === 'extrude' || grab.tool === 'spike') this.sculptor.endExtrude(String(key));
    this.grabs.delete(key);
    this.pinching.delete(key);
  }
}
