// Landmark topology, filtering and pose reading for MediaPipe hands.

export const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

export const FINGERS = [
  { name: 'Thumb', joints: [1, 2, 3, 4], labels: ['CMC', 'MCP', 'IP', 'TIP'] },
  { name: 'Index', joints: [5, 6, 7, 8], labels: ['MCP', 'PIP', 'DIP', 'TIP'] },
  { name: 'Middle', joints: [9, 10, 11, 12], labels: ['MCP', 'PIP', 'DIP', 'TIP'] },
  { name: 'Ring', joints: [13, 14, 15, 16], labels: ['MCP', 'PIP', 'DIP', 'TIP'] },
  { name: 'Little', joints: [17, 18, 19, 20], labels: ['MCP', 'PIP', 'DIP', 'TIP'] },
];

export const TIPS = [4, 8, 12, 16, 20];

/** One-Euro filter (Casiez et al.): low jitter at rest, low lag in motion. */
class OneEuro {
  private x: number | null = null;
  private dx = 0;
  constructor(private minCutoff = 1.4, private beta = 0.012, private dCutoff = 1.0) {}
  private alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(v: number, dt: number) {
    if (this.x === null) {
      this.x = v;
      return v;
    }
    const d = (v - this.x) / dt;
    this.dx += this.alpha(this.dCutoff, dt) * (d - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx) * 1000;
    this.x += this.alpha(cutoff, dt) * (v - this.x);
    return this.x;
  }
}

export class HandFilter {
  private f = Array.from({ length: 63 }, () => new OneEuro());
  apply(lm: Float32Array, dt: number) {
    for (let i = 0; i < 63; i++) lm[i] = this.f[i].filter(lm[i], dt);
    return lm;
  }
}

export type Pose = 'open' | 'fist' | 'pinch' | 'point' | 'two' | 'none';

export interface HandFrame {
  lm: Float32Array; // 21 × xyz, normalized image coords (x not mirrored)
  right: boolean;
  pose: Pose;
  span: number; // palm size in image units (aspect corrected)
  pinchRatio: number;
}

export interface Calibration {
  span: number; // palm size at comfortable distance
  pinchOn: number; // ratio below which a pinch is read
  aspect: number; // camera width / height
  mmPerUnit: number;
}

export const DEFAULT_CAL: Calibration = { span: 0.2, pinchOn: 0.32, aspect: 4 / 3, mmPerUnit: 420 };

const P = (lm: Float32Array, i: number, aspect: number) => [lm[i * 3] * aspect, lm[i * 3 + 1], lm[i * 3 + 2] * aspect];
export function dist(lm: Float32Array, a: number, b: number, aspect: number) {
  const p = P(lm, a, aspect), q = P(lm, b, aspect);
  return Math.hypot(p[0] - q[0], p[1] - q[1]);
}

export function palmSpan(lm: Float32Array, aspect: number) {
  return (dist(lm, 0, 9, aspect) + dist(lm, 5, 17, aspect) * 1.25) / 2;
}

function extended(lm: Float32Array, tip: number, pip: number, aspect: number) {
  return dist(lm, tip, 0, aspect) > dist(lm, pip, 0, aspect) * 1.12;
}

export function readPose(lm: Float32Array, cal: Calibration): { pose: Pose; span: number; pinchRatio: number } {
  const a = cal.aspect;
  const span = palmSpan(lm, a);
  const pinchRatio = dist(lm, 4, 8, a) / span;
  const idx = extended(lm, 8, 6, a);
  const mid = extended(lm, 12, 10, a);
  const ring = extended(lm, 16, 14, a);
  const lit = extended(lm, 20, 18, a);
  let pose: Pose = 'none';
  if (pinchRatio < cal.pinchOn && !ring) pose = 'pinch';
  else if (idx && mid && ring && lit) pose = 'open';
  else if (idx && mid && !ring && !lit) pose = 'two';
  else if (idx && !mid && !ring && !lit) pose = 'point';
  else if (!idx && !mid && !ring && !lit) pose = 'fist';
  return { pose, span, pinchRatio };
}

/** Requires a pose to persist for a few frames before switching. */
export class PoseDebounce {
  private current: Pose = 'none';
  private candidate: Pose = 'none';
  private count = 0;
  constructor(private frames = 3) {}
  push(p: Pose) {
    if (p === this.current) {
      this.count = 0;
      return this.current;
    }
    if (p === this.candidate) this.count++;
    else {
      this.candidate = p;
      this.count = 1;
    }
    if (this.count >= this.frames) {
      this.current = p;
      this.count = 0;
    }
    return this.current;
  }
}
