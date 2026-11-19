import { Vector3 } from 'three';
import type { Atelier } from '../render/atelier';
import { ROUNDED, SPIKE, type Sculptor, type ToolKind } from '../sculpt/sculptor';

/**
 * Pointer input: a precise path for testing and a full fallback when no
 * camera is available. Same tools and the same feel as the hands.
 */
export class PointerInput {
  tool: ToolKind = 'extrude';
  enabled = false;
  onToolChange: (t: ToolKind) => void = () => {};

  private down = false;
  private turning = false;
  private extruding = false;
  private held = 0;
  private x = 0;
  private y = 0;
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private lastY = 0;
  private hover = false;
  private d = new Vector3();
  private hit = new Vector3();

  constructor(private el: HTMLElement, private atelier: Atelier, private sculptor: Sculptor) {
    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      el.setPointerCapture(e.pointerId);
      this.down = true;
      this.held = 0;
      this.turning = e.button === 2 || e.shiftKey || this.tool === 'turn';
      this.setPos(e);
      this.startX = this.lastX = this.x;
      this.startY = this.lastY = this.y;
      if (!this.turning && (this.tool === 'extrude' || this.tool === 'spike')) {
        const hit = this.atelier.castSurface(this.x, this.y);
        this.extruding = !!hit && this.sculptor.beginExtrude('pointer', hit, this.tool === 'spike' ? SPIKE : ROUNDED);
      }
    });
    el.addEventListener('pointermove', (e) => this.setPos(e));
    const up = () => {
      if (this.extruding) this.sculptor.endExtrude('pointer');
      this.extruding = false;
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

  private cast(): boolean {
    const hit = this.atelier.castSurface(this.x, this.y);
    if (!hit) return false;
    this.hit.copy(hit.point);
    this.d.copy(hit.dir);
    return true;
  }

  /** Per frame. Returns surface markers for the shader. */
  update(dt: number): { pos: Vector3; strength: number }[] {
    if (!this.enabled) return [];
    if (this.down) this.held += dt;
    const ease = Math.min(1, this.held / 0.35); // tools ease in

    if (this.turning && this.down) {
      const dx = this.x - this.lastX, dy = this.y - this.lastY;
      if (dx || dy) this.atelier.rotateBy(dx * 0.006, dy * 0.006);
      this.lastX = this.x;
      this.lastY = this.y;
      return [];
    }
    if (this.extruding) {
      this.sculptor.dragExtrude('pointer', this.x - this.startX, this.y - this.startY, dt);
      return this.cast() ? [{ pos: this.hit.clone(), strength: 1 }] : [];
    }
    if (!this.hover || !this.cast()) return [];
    if (this.down) {
      if (this.tool === 'drill') this.sculptor.drill(this.hit, this.d, dt, ease);
      else if (this.tool === 'smooth') this.sculptor.smooth(this.hit, dt, ease);
    }
    return [{ pos: this.hit.clone(), strength: this.down ? 1 : 0.5 }];
  }
}
