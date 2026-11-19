import { BONES, FINGERS, TIPS, type HandFrame } from '../input/handModel';
import type { HandActivity } from '../input/handInput';

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
/** 0 at the wrist and knuckles … 1 at the fingertips. */
function depthInFinger(i: number) {
  if (i === 0) return 0;
  return ((i - 1) % 4) / 3;
}

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

  // Display-only easing of landmarks: the drawing glides instead of
  // snapping to each camera frame (interaction still uses the raw data).
  private shown = new Map<boolean, Float32Array>();
  private pulses = new Map<boolean, number>();
  private engagedBefore = new Map<boolean, boolean>();
  private lastDt = 0;

  draw(hands: HandFrame[], mode: OverlayMode, dt: number, mmPerUnit: number, active?: Map<HandFrame, HandActivity>) {
    this.t += dt;
    this.lastDt = dt;
    const c = this.ctx;
    this.clear();
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const k = 1 - Math.exp(-dt * (mode === 'calibrate' ? 9 : 16));
    const seen = new Set<boolean>();
    hands.forEach((h, hi) => {
      seen.add(h.right);
      let s = this.shown.get(h.right);
      if (!s) {
        s = h.lm.slice();
        this.shown.set(h.right, s);
      }
      for (let i = 0; i < 63; i++) s[i] += (h.lm[i] - s[i]) * k;
      this.drawHand({ ...h, lm: s }, mode, hi === 0, mmPerUnit, active?.get(h));
    });
    for (const key of [...this.shown.keys()]) if (!seen.has(key)) this.shown.delete(key);
  }

  private drawHand(h: HandFrame, mode: OverlayMode, primary: boolean, mmPerUnit: number, act?: HandActivity) {
    const c = this.ctx;
    const m = this.map;
    const X = (i: number) => m.x(h.lm[i * 3]);
    const Y = (i: number) => m.y(h.lm[i * 3 + 1]);
    const cal = mode === 'calibrate';
    const strength = cal ? 1 : 0.7;

    // Palm: a whisper of fill.
    c.beginPath();
    [0, 1, 5, 9, 13, 17].forEach((i, k) => (k ? c.lineTo(X(i), Y(i)) : c.moveTo(X(i), Y(i))));
    c.closePath();
    c.fillStyle = `rgba(${INK}, ${0.035 * strength})`;
    c.fill();

    // Bones: hairlines that fade from the wrist out to the fingertips.
    c.lineCap = 'round';
    for (const [a, b] of BONES) {
      const g = c.createLinearGradient(X(a), Y(a), X(b), Y(b));
      const fa = 0.14 + 0.3 * depthInFinger(a), fb = 0.14 + 0.3 * depthInFinger(b);
      g.addColorStop(0, `rgba(${INK}, ${fa * strength})`);
      g.addColorStop(1, `rgba(${INK}, ${fb * strength})`);
      c.strokeStyle = g;
      c.lineWidth = 0.9;
      c.beginPath();
      c.moveTo(X(a), Y(a));
      c.lineTo(X(b), Y(b));
      c.stroke();
    }

    // Dimension lines (calibration only, primary hand).
    if (cal && primary) {
      for (const f of FINGERS) this.dimension(h, f.joints[0], f.joints[3], mmPerUnit, X, Y);
    }

    // Joints: small solid points; fingertips get a soft halo.
    for (let i = 0; i < 21; i++) {
      const tip = TIPS.includes(i);
      if (tip) {
        const halo = c.createRadialGradient(X(i), Y(i), 0, X(i), Y(i), 12);
        halo.addColorStop(0, `rgba(169, 184, 46, ${0.28 * strength})`);
        halo.addColorStop(1, 'rgba(169, 184, 46, 0)');
        c.fillStyle = halo;
        c.beginPath();
        c.arc(X(i), Y(i), 12, 0, Math.PI * 2);
        c.fill();
      }
      c.beginPath();
      c.arc(X(i), Y(i), tip ? 2.6 : i === 0 ? 2.2 : 1.5, 0, Math.PI * 2);
      c.fillStyle = `rgba(${INK}, ${(tip ? 0.75 : 0.45) * strength})`;
      c.fill();
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

    // Close but not registering: a gentle hint beside the fingertips.
    if (act && mode === 'sculpt' && act.hint) {
      c.save();
      c.font = '500 12px "Instrument Sans", sans-serif';
      c.fillStyle = `rgba(${INK}, 0.7)`;
      c.textBaseline = 'middle';
      c.fillText('Bring the tips fully together', (X(4) + X(8)) / 2 + 16, (Y(4) + Y(8)) / 2 - 18);
      c.restore();
    }

    // Diagnostic view (key D): the live pinch numbers under the wrist.
    if (act?.debug) {
      c.save();
      c.font = '500 11px "Instrument Sans", sans-serif';
      c.fillStyle = `rgba(${INK}, 0.75)`;
      c.textAlign = 'center';
      act.debug.forEach((line, i) => c.fillText(line, X(0), Y(0) + 46 + i * 15));
      c.restore();
    }

    // Pinch: a soft dot between thumb and index that grows as the fingers
    // close, turns lime when the pinch holds, and pulses once as a grab takes.
    if (act && mode === 'sculpt') {
      const mx = (X(4) + X(8)) / 2, my = (Y(4) + Y(8)) / 2;
      const held = act.engaged || act.pinch >= 0.999;
      const r = 2.5 + 5 * act.pinch;
      c.beginPath();
      c.arc(mx, my, r, 0, Math.PI * 2);
      c.fillStyle = held ? SIGNAL : `rgba(${INK}, ${0.18 + 0.3 * act.pinch})`;
      c.fill();
      const key = h.right;
      const was = this.engagedBefore.get(key) ?? false;
      if (act.engaged && !was) this.pulses.set(key, 0);
      this.engagedBefore.set(key, act.engaged);
      const t = this.pulses.get(key);
      if (t !== undefined) {
        const k = Math.min(1, t / 0.45);
        c.beginPath();
        c.arc(mx, my, r + 4 + k * 18, 0, Math.PI * 2);
        c.lineWidth = 1.5;
        c.strokeStyle = `rgba(169, 184, 46, ${0.6 * (1 - k)})`;
        c.stroke();
        if (k >= 1) this.pulses.delete(key);
        else this.pulses.set(key, t + this.lastDt);
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
    c.strokeStyle = `rgba(${INK}, 0.22)`;
    c.lineWidth = 0.6;
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
    c.font = '500 9px "Instrument Sans", sans-serif';
    c.fillStyle = `rgba(${INK}, 0.5)`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(`${mm} mm`, 0, 0);
    c.restore();
  }
}
