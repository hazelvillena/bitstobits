import type { Calibration, HandFrame } from './handModel';

/**
 * Pinch detection from two signals, so one weak signal never blocks a pinch:
 * - 3D: thumb to index tip from MediaPipe's world landmarks, divided by palm
 *   width. Right when pointing (the on-screen gap shrinks then), weakest when
 *   the fingertips overlap from the camera's view.
 * - 2D: the same gap on screen, divided by the palm's size on screen. Right
 *   when the tips touch in view, which is exactly where 3D is weakest.
 * Each is turned into "closeness" (0 open … 1 closed) against this hand's
 * calibrated open and closed values; the pinch uses the stronger of the two.
 * A straight index whose tip is clearly apart on screen (pointing) never
 * counts. Start and release differ (hysteresis), and every real pinch nudges
 * the closed values toward what this hand actually does.
 */
export const START = 0.7; // closeness to start a pinch
export const RELEASE = 0.5; // closeness below which it releases
const HOLD = 0.035; // seconds the start must hold: about one camera frame

export interface PinchReading {
  on: boolean;
  started: boolean;
  /** 0 open … 1 closed, the stronger signal. */
  amount: number;
  c3: number;
  c2: number;
  pointing: boolean;
  /** Close but not registering for a while: show a hint. */
  hint: boolean;
}

const closeness = (x: number, open: number, closed: number) =>
  Math.min(1, Math.max(0, (open - x) / Math.max(1e-3, open - closed)));

export class PinchDetector {
  private on = false;
  private t = 0;
  private nearT = 0;
  private min3 = Infinity;
  private min2 = Infinity;

  constructor(private cal: Calibration, private onLearn: () => void = () => {}) {}

  update(h: HandFrame, dt: number): PinchReading {
    const cal = this.cal;
    const c3 = closeness(h.pinchRel, cal.open3, cal.closed3);
    const c2 = closeness(h.pinchRatio, cal.open2, cal.closed2);
    const amount = Math.max(c3, c2);
    const pointing = h.indexBend < cal.bendMin * 0.5 && c2 < 0.85;
    const was = this.on;

    if (this.on) {
      this.min3 = Math.min(this.min3, h.pinchRel);
      this.min2 = Math.min(this.min2, h.pinchRatio);
      if (amount < RELEASE) {
        this.on = false;
        this.learn();
      }
    } else {
      this.t = amount >= START && !pointing ? this.t + dt : 0;
      if (this.t >= HOLD) {
        this.on = true;
        this.min3 = h.pinchRel;
        this.min2 = h.pinchRatio;
      }
    }
    // Hovering just short of a pinch for a while: suggest closing fully.
    this.nearT = !this.on && amount > 0.45 && amount < START ? this.nearT + dt : 0;
    return { on: this.on, started: this.on && !was, amount, c3, c2, pointing, hint: this.nearT > 0.6 };
  }

  /** Nudge this hand's closed values toward its real pinches (bounded). */
  private learn() {
    const cal = this.cal;
    if (Number.isFinite(this.min3)) cal.closed3 = clamp(cal.closed3 + (this.min3 - cal.closed3) * 0.15, 0.05, cal.open3 * 0.6);
    if (Number.isFinite(this.min2)) cal.closed2 = clamp(cal.closed2 + (this.min2 - cal.closed2) * 0.15, 0.03, cal.open2 * 0.6);
    this.onLearn();
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
