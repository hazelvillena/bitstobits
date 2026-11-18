import { BONES, FINGERS, TIPS, type HandFrame } from '../input/handModel';

export type OverlayMode = 'calibrate' | 'sculpt';

const INK = '27, 33, 39';
const SIGNAL = '#a9b82e';

/**
 * Maps camera landmarks into pane pixels (mirrored, cover-fit, with a reach
 * gain so small hand motions cover the whole plate).
 */
export class PaneMapping {
  W = 1;
  H = 1;
  gain = 1.3;
  aspect = 4 / 3;
  set(W: number, H: number, aspect: number) {
    this.W = W;
    this.H = H;
    this.aspect = aspect;
  }
  x(u: number) {
    const S = Math.max(this.H, this.W / this.aspect);
    return this.W / 2 + (0.5 - u) * S * this.aspect * this.gain;
  }
  y(v: number) {
    const S = Math.max(this.H, this.W / this.aspect);
    return this.H / 2 + (v - 0.5) * S * this.gain;
  }
}

/** Draws the measured hand: nodes, bones, and (in calibration) dimensions. */
export class HandOverlay {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  readonly map = new PaneMapping();
  private t = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize(aspect: number) {
    this.dpr = Math.min(window.devicePixelRatio, 2);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.map.set(w, h, aspect);
  }

  clear() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  draw(hands: HandFrame[], mode: OverlayMode, dt: number, mmPerUnit: number, active?: Map<HandFrame, { tool: string; engaged: boolean; label: string }>) {
    this.t += dt;
    const c = this.ctx;
    this.clear();
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    hands.forEach((h, hi) => this.drawHand(h, mode, hi === 0, mmPerUnit, active?.get(h)));
  }

  private drawHand(h: HandFrame, mode: OverlayMode, primary: boolean, mmPerUnit: number, act?: { tool: string; engaged: boolean; label: string }) {
    const c = this.ctx;
    const m = this.map;
    const X = (i: number) => m.x(h.lm[i * 3]);
    const Y = (i: number) => m.y(h.lm[i * 3 + 1]);
    const cal = mode === 'calibrate';

    // Palm plane, lightly filled.
    c.beginPath();
    [0, 1, 5, 9, 13, 17].forEach((i, k) => (k ? c.lineTo(X(i), Y(i)) : c.moveTo(X(i), Y(i))));
    c.closePath();
    c.fillStyle = `rgba(${INK}, ${cal ? 0.045 : 0.03})`;
    c.fill();

    // Bones.
    c.lineWidth = 1;
    c.strokeStyle = `rgba(${INK}, ${cal ? 0.5 : 0.32})`;
    c.beginPath();
    for (const [a, b] of BONES) {
      c.moveTo(X(a), Y(a));
      c.lineTo(X(b), Y(b));
    }
    c.stroke();

    // Dimension lines (calibration only, primary hand).
    if (cal && primary) {
      for (const f of FINGERS) this.dimension(h, f.joints[0], f.joints[3], mmPerUnit, X, Y);
    }

    // Joints.
    for (let i = 0; i < 21; i++) {
      const tip = TIPS.includes(i);
      const r = tip ? 4 : i === 0 ? 3.5 : 2.4;
      c.beginPath();
      c.arc(X(i), Y(i), r, 0, Math.PI * 2);
      c.fillStyle = '#f3f1ec';
      c.fill();
      c.lineWidth = 1;
      c.strokeStyle = `rgba(${INK}, ${cal ? 0.85 : 0.55})`;
      c.stroke();
    }

    // What the hand is doing right now, in plain words beside the wrist.
    if (act && mode === 'sculpt') {
      c.save();
      c.font = '500 13px "Instrument Sans", sans-serif';
      c.textBaseline = 'middle';
      c.textAlign = 'center';
      c.fillStyle = act.engaged ? `rgba(${INK}, 0.92)` : `rgba(${INK}, 0.5)`;
      c.fillText(act.label, X(0), Y(0) + 26);
      c.restore();
    }

    // Engaged fingertips glow in signal.
    if (act) {
      const live = act.tool === 'drill' ? [8] : act.tool === 'pull' ? [4, 8] : act.tool === 'smooth' ? [8, 12] : act.tool === 'press' ? [0, 5, 9, 13, 17] : [];
      for (const i of live) {
        c.beginPath();
        c.arc(X(i), Y(i), act.engaged ? 5 : 4, 0, Math.PI * 2);
        c.fillStyle = SIGNAL;
        c.fill();
        if (act.engaged) {
          const pulse = (this.t * 1.4) % 1;
          c.beginPath();
          c.arc(X(i), Y(i), 6 + pulse * 14, 0, Math.PI * 2);
          c.strokeStyle = `rgba(169, 184, 46, ${0.6 * (1 - pulse)})`;
          c.stroke();
        }
      }
    }

  }

  /** Architectural dimension line alongside a finger, with its length. */
  private dimension(h: HandFrame, a: number, b: number, mmPerUnit: number, X: (i: number) => number, Y: (i: number) => number) {
    const c = this.ctx;
    const ax = X(a), ay = Y(a), bx = X(b), by = Y(b);
    let dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const nx = dy, ny = -dx; // offset side
    const off = 16;
    const x1 = ax + nx * off, y1 = ay + ny * off, x2 = bx + nx * off, y2 = by + ny * off;
    c.strokeStyle = `rgba(${INK}, 0.38)`;
    c.lineWidth = 0.75;
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    // Extension ticks.
    for (const [x, y] of [[x1, y1], [x2, y2]]) {
      c.moveTo(x - nx * 4 - dx * 3, y - ny * 4 - dy * 3);
      c.lineTo(x + nx * 4 + dx * 3, y + ny * 4 + dy * 3);
    }
    c.stroke();

    // Real length along the chain of joints.
    let units = 0;
    const asp = this.map.aspect;
    for (let j = a; j < b; j++) {
      units += Math.hypot((h.lm[(j + 1) * 3] - h.lm[j * 3]) * asp, h.lm[(j + 1) * 3 + 1] - h.lm[j * 3 + 1]);
    }
    const mm = Math.round(units * mmPerUnit);
    c.save();
    c.translate((x1 + x2) / 2 + nx * 9, (y1 + y2) / 2 + ny * 9);
    let ang = Math.atan2(dy, dx);
    if (ang > Math.PI / 2) ang -= Math.PI;
    if (ang < -Math.PI / 2) ang += Math.PI;
    c.rotate(ang);
    c.font = '500 9.5px "Instrument Sans", sans-serif';
    c.fillStyle = `rgba(${INK}, 0.7)`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(`${mm} mm`, 0, 0);
    c.restore();
  }
}
