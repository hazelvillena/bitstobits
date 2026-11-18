import { Vector3 } from 'three';
import type { Atelier } from '../render/atelier';
import type { Sculptor, ToolKind } from '../sculpt/sculptor';
import type { HandFrame } from './handModel';
import type { HandTracker } from './handTracker';
import type { PaneMapping } from '../ui/handOverlay';

const POSE_TOOL: Record<string, ToolKind | undefined> = {
  point: 'drill',
  pinch: 'pull',
  open: 'press',
  two: 'smooth',
  fist: 'turn',
};

/**
 * Turns tracked hands into sculpting. Depth comes from the palm's apparent
 * size against the calibrated size, plus each landmark's relative depth.
 */
export class HandInput {
  enabled = false;
  acceptHold = 0;
  activity = new Map<HandFrame, { tool: ToolKind; engaged: boolean }>();
  private lastPalm = new Map<boolean, { x: number; y: number }>();
  private prevTip = new Map<boolean, Vector3>();

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

  /** Per frame. Returns fingertip markers for the shader and the primary tool. */
  update(dt: number): { tips: { pos: Vector3; strength: number }[]; tool: ToolKind | null } {
    this.activity.clear();
    if (!this.enabled) return { tips: [], tool: null };
    const hands = this.tracker.hands;
    const tips: { pos: Vector3; strength: number }[] = [];
    let primary: ToolKind | null = null;

    // Keep: both palms open and held away from the form.
    const bothOpen = hands.length === 2 && hands.every((h) => h.pose === 'open');
    if (bothOpen) {
      const away = hands.every((h) => this.sculptor.distanceAt(this.mid(h, 0, 9, new Vector3())) > 0.2);
      this.acceptHold = away ? this.acceptHold + dt : 0;
    } else this.acceptHold = Math.max(0, this.acceptHold - dt * 3);

    for (const h of hands) {
      const tool = POSE_TOOL[h.pose];
      let engaged = false;
      const key = h.right;

      // Faint markers on every index tip, so the form answers to presence.
      const idx = this.world(h, 8, new Vector3());
      tips.push({ pos: idx, strength: 0.4 });

      if (!tool || bothOpen) {
        this.sculptor.pull(String(key), idx, false);
        this.prevTip.delete(key);
        this.lastPalm.delete(key);
        continue;
      }
      if (tool !== 'pull') this.sculptor.pull(String(key), idx, false);

      if (tool === 'drill') {
        const prev = this.prevTip.get(key);
        const dir = new Vector3();
        if (prev && prev.distanceTo(idx) > 0.002) dir.copy(idx).sub(prev).normalize();
        else this.world(h, 8, dir).sub(this.world(h, 6, new Vector3())).normalize();
        dir.z = Math.min(dir.z, -0.3); // piercing travels into the scene
        dir.normalize();
        engaged = this.sculptor.drill(idx, dir, dt);
        this.prevTip.set(key, idx.clone());
        tips[tips.length - 1].strength = 1;
      } else if (tool === 'pull') {
        const p = this.mid(h, 4, 8, new Vector3());
        engaged = this.sculptor.pull(String(key), p, true);
        tips.push({ pos: p, strength: 1 });
      } else if (tool === 'press') {
        const p = this.mid(h, 0, 9, new Vector3());
        p.lerp(this.world(h, 9, new Vector3()), 0.5);
        engaged = this.sculptor.press(p, new Vector3(0, 0, -1), dt);
        tips.push({ pos: p, strength: 0.9 });
      } else if (tool === 'smooth') {
        const p = this.mid(h, 8, 12, new Vector3());
        engaged = this.sculptor.smooth(p, dt);
        tips.push({ pos: p, strength: 0.8 });
      } else if (tool === 'turn') {
        const px = { x: this.map.x(h.lm[27]), y: this.map.y(h.lm[28]) };
        const last = this.lastPalm.get(key);
        if (last) this.atelier.rotateBy((px.x - last.x) * 0.004, (px.y - last.y) * 0.004);
        this.lastPalm.set(key, px);
        engaged = true;
      }
      if (tool !== 'turn') this.lastPalm.delete(key);
      if (tool !== 'drill') this.prevTip.delete(key);

      this.activity.set(h, { tool, engaged });
      if (!primary || engaged) primary = tool;
    }
    return { tips, tool: primary };
  }
}
