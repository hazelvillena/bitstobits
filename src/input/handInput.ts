import { Vector3 } from 'three';
import type { Atelier } from '../render/atelier';
import { TOOLS, type Sculptor, type ToolKind } from '../sculpt/sculptor';
import type { HandFrame } from './handModel';
import type { HandTracker } from './handTracker';
import type { PaneMapping } from '../ui/handOverlay';

/**
 * Turns tracked hands into sculpting with the tool the person selected
 * (keys 1 to 5 or the tool list). Hands never choose the tool; they only aim
 * and act:
 * - Pierce, Press, Smooth act where the index fingertip touches the form.
 * - Pull and Rotate act only while pinching, like a clutch.
 * Depth comes from the palm's apparent size against the calibrated size,
 * plus each landmark's relative depth.
 */
export class HandInput {
  enabled = false;
  tool: () => ToolKind = () => 'pull';
  activity = new Map<HandFrame, { tool: string; engaged: boolean; label: string }>();
  private lastPinch = new Map<boolean, { x: number; y: number }>();
  private prevTip = new Map<boolean, Vector3>();
  private pinching = new Map<boolean, boolean>();

  constructor(
    private tracker: HandTracker,
    private atelier: Atelier,
    private sculptor: Sculptor,
    private map: PaneMapping,
  ) {}

  private world(h: HandFrame, i: number, out: Vector3) {
    const r = h.span / this.tracker.cal.span;
    // r = 1 at the calibrated distance; leaning in drives the hand into the scene.
    const zPalm = 1.25 - (r - 1) * 3.4;
    const z = zPalm + h.lm[i * 3 + 2] * 3.2;
    return this.atelier.pointAtDepth(this.map.x(h.lm[i * 3]), this.map.y(h.lm[i * 3 + 1]), z, out);
  }

  private mid(h: HandFrame, a: number, b: number, out: Vector3) {
    const t = new Vector3();
    this.world(h, a, out);
    this.world(h, b, t);
    return out.add(t).multiplyScalar(0.5);
  }

  /** Pinch with hysteresis, so a grab doesn't drop when fingers flutter. */
  private isPinching(h: HandFrame) {
    const on = this.tracker.cal.pinchOn;
    const was = this.pinching.get(h.right) ?? false;
    const now = was ? h.pinchRatio < on * 1.45 : h.pinchRatio < on;
    this.pinching.set(h.right, now);
    return now;
  }

  /** Per frame. Returns fingertip markers for the shader. */
  update(dt: number): { tips: { pos: Vector3; strength: number }[] } {
    this.activity.clear();
    if (!this.enabled) return { tips: [] };
    const hands = this.tracker.hands;
    const tips: { pos: Vector3; strength: number }[] = [];
    const tool = this.tool();
    const label = TOOLS.find((t) => t.kind === tool)!.name;

    for (const h of hands) {
      const key = h.right;
      const idx = this.world(h, 8, new Vector3());
      const pinch = this.isPinching(h);
      let engaged = false;

      if (tool === 'drill' || tool === 'press' || tool === 'smooth') {
        tips.push({ pos: idx, strength: 0.9 });
        if (tool === 'drill') {
          const prev = this.prevTip.get(key);
          const dir = new Vector3();
          if (prev && prev.distanceTo(idx) > 0.004) dir.copy(idx).sub(prev).normalize();
          else dir.set(0, 0, -1);
          dir.z = Math.min(dir.z, -0.4); // piercing travels into the scene
          dir.normalize();
          engaged = this.sculptor.drill(idx, dir, dt);
          this.prevTip.set(key, idx.clone());
        } else if (tool === 'press') {
          engaged = this.sculptor.press(idx, new Vector3(0, 0, -1), dt, 0.2);
        } else {
          engaged = this.sculptor.smooth(idx, dt);
        }
      } else if (tool === 'pull') {
        const p = this.mid(h, 4, 8, new Vector3());
        tips.push({ pos: p, strength: pinch ? 1 : 0.6 });
        engaged = this.sculptor.pull(String(key), p, pinch);
      } else if (tool === 'turn') {
        tips.push({ pos: idx, strength: 0.4 });
        if (pinch) {
          const px = { x: this.map.x(h.lm[24]), y: this.map.y(h.lm[25]) };
          const last = this.lastPinch.get(key);
          if (last) this.atelier.rotateBy((px.x - last.x) * 0.004, (px.y - last.y) * 0.004);
          this.lastPinch.set(key, px);
          engaged = true;
        } else this.lastPinch.delete(key);
      }
      if (tool !== 'pull') this.sculptor.pull(String(key), idx, false);
      if (tool !== 'drill') this.prevTip.delete(key);
      if (tool !== 'turn') this.lastPinch.delete(key);
      this.activity.set(h, { tool, engaged, label });
    }
    return { tips };
  }

}
