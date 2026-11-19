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
  /** Thumb tip to index tip in metres (3D), smoothed. */
  pinchDist: number;
  /** pinchDist divided by palm width: the same for small and large hands. */
  pinchRel: number;
  /** How bent the index finger is (radians): pinching curls it, pointing keeps it straight. */
  indexBend: number;
}

export interface Calibration {
  span: number; // palm size at comfortable distance
  pinchOn: number; // ratio below which a pinch is read
  aspect: number; // camera width / height
  mmPerUnit: number;
  /**
   * Pinch thresholds, relative to palm width: start below `pinchStart`,
   * release above `pinchRelease`. `pinchOpen` is the open hand's value.
   */
  pinchStart: number;
  pinchRelease: number;
  pinchOpen: number;
  /** Minimum index bend (radians) for a pinch; pointing stays below it. */
  bendMin: number;
}

// Pinch defaults, relative to palm width (about 8 cm): start near 2.4 cm, release near 3.8 cm,
// in line with Meta's start and stop thresholds; refined per hand in calibration.
export const DEFAULT_CAL: Calibration = {
  span: 0.2, pinchOn: 0.32, aspect: 4 / 3, mmPerUnit: 420,
  pinchStart: 0.3, pinchRelease: 0.48, pinchOpen: 1.1, bendMin: 0.5,
};

const P = (lm: Float32Array, i: number, aspect: number) => [lm[i * 3] * aspect, lm[i * 3 + 1], lm[i * 3 + 2] * aspect];
export function dist(lm: Float32Array, a: number, b: number, aspect: number) {
  const p = P(lm, a, aspect), q = P(lm, b, aspect);
  return Math.hypot(p[0] - q[0], p[1] - q[1]);
}

export function palmSpan(lm: Float32Array, aspect: number) {
  return (dist(lm, 0, 9, aspect) + dist(lm, 5, 17, aspect) * 1.25) / 2;
}

/**
 * Total bend of a finger chain in radians, measured in 3D. Joint angles do
 * not depend on how the hand is turned to the camera, unlike tip distances.
 */
export function bend(lm: Float32Array, j: number[], aspect: number) {
  let total = 0;
  for (let k = 0; k < j.length - 2; k++) {
    const a = P(lm, j[k], aspect), b = P(lm, j[k + 1], aspect), c = P(lm, j[k + 2], aspect);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
    const d = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v) || 1);
    total += Math.acos(Math.max(-1, Math.min(1, d)));
  }
  return total;
}

export function readPose(lm: Float32Array, cal: Calibration): { pose: Pose; span: number; pinchRatio: number } {
  const a = cal.aspect;
  const span = palmSpan(lm, a);
  const pinchRatio = dist(lm, 4, 8, a) / span;
  // Include the knuckle: wrist → MCP → PIP → DIP → TIP.
  const ext = (f: number[]) => bend(lm, [0, ...f], a) < 1.25;
  const curled = (f: number[]) => bend(lm, [0, ...f], a) > 1.7;
  const idx = ext([5, 6, 7, 8]);
  const mid = ext([9, 10, 11, 12]);
  const ring = ext([13, 14, 15, 16]);
  const lit = ext([17, 18, 19, 20]);
  const othersCurled = curled([9, 10, 11, 12]) && curled([13, 14, 15, 16]) && curled([17, 18, 19, 20]);

  let pose: Pose = 'none';
  if (pinchRatio < cal.pinchOn) pose = 'pinch';
  else if (idx && mid && ring && lit) pose = 'open';
  else if (idx && mid && !ring && !lit) pose = 'two';
  else if (idx && othersCurled) pose = 'point';
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
