import { Vector3 } from 'three';
import type { Atelier } from '../render/atelier';
import type { Sculptor, ToolKind } from '../sculpt/sculptor';

/**
 * Pointer input: a precise debug path and a full fallback when no camera
 * is available. Same tools as the hands.
 */
export class PointerInput {
  tool: ToolKind = 'drill';
  enabled = false;
  onToolChange: (t: ToolKind) => void = () => {};

  private down = false;
  private turning = false;
  private x = 0;
  private y = 0;
  private lastX = 0;
  private lastY = 0;
  private hover = false;
  private anchorDepth = 0;
  private d = new Vector3();
  private hit = new Vector3();

  constructor(private el: HTMLElement, private atelier: Atelier, private sculptor: Sculptor) {
    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      el.setPointerCapture(e.pointerId);
      this.down = true;
      this.turning = e.button === 2 || e.shiftKey || this.tool === 'turn';
      this.setPos(e);
      this.lastX = this.x;
      this.lastY = this.y;
      if (!this.turning && this.tool === 'pull') this.beginPull();
    });
    el.addEventListener('pointermove', (e) => this.setPos(e));
    const up = () => {
      if (this.down && this.tool === 'pull') this.sculptor.pull('pointer', this.hit, false);
      this.down = false;
      this.turning = false;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', () => (this.hover = false));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private setPos(e: PointerEvent) {
    const r = this.el.getBoundingClientRect();
    this.x = e.clientX - r.left;
    this.y = e.clientY - r.top;
    this.hover = true;
  }

  setTool(t: ToolKind) {
    this.tool = t;
    this.onToolChange(t);
  }

  /** Cast onto the visible surface; writes the world hit point. */
  private cast(): boolean {
    const hit = this.atelier.castSurface(this.x, this.y);
    if (!hit) return false;
    this.hit.copy(hit.point);
    this.d.copy(hit.dir);
    this.anchorDepth = hit.dist;
    return true;
  }

  private beginPull() {
    if (this.cast()) this.sculptor.pull('pointer', this.hit, true);
  }

  /** Per-frame. Returns proximity markers for the shader. */
  update(dt: number): { pos: Vector3; strength: number }[] {
    if (!this.enabled) return [];
    if (this.turning && this.down) {
      const dx = this.x - this.lastX, dy = this.y - this.lastY;
      this.atelier.rotateBy(dx * 0.0016, dy * 0.0016);
      this.lastX = this.x;
      this.lastY = this.y;
      return [];
    }
    if (this.down && this.tool === 'pull') {
      // Follow the pointer on the plane at the anchor's depth.
      const p = this.atelier.pointOnRay(this.x, this.y, this.anchorDepth, new Vector3());
      this.sculptor.pull('pointer', p, true);
      return [{ pos: p, strength: 1 }];
    }
    if (!this.hover || !this.cast()) return [];
    if (this.down) {
      if (this.tool === 'drill') this.sculptor.drill(this.hit, this.d, dt);
      else if (this.tool === 'press') this.sculptor.press(this.hit, this.d, dt);
      else if (this.tool === 'smooth') this.sculptor.smooth(this.hit, dt);
    }
    return [{ pos: this.hit.clone(), strength: this.down ? 1 : 0.55 }];
  }
}
