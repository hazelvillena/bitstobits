import { Vector3 } from 'three';
import { Volume } from './volume';
import { ROUNDED, SPIKE, taper, type Profile } from './profiles';

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// Face normals of a rhombicuboctahedron: 6 cube faces, 12 edge faces, 8 corner triangles.
const S2 = Math.SQRT1_2, S3 = 1 / Math.sqrt(3);
const RHOMBI: { n: [number, number, number]; d: number }[] = [];
for (const a of [0, 1, 2]) for (const s of [-1, 1]) {
  const n: [number, number, number] = [0, 0, 0];
  n[a] = s;
  RHOMBI.push({ n, d: 1 });
}
for (const [a, b] of [[0, 1], [1, 2], [0, 2]]) for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
  const n: [number, number, number] = [0, 0, 0];
  n[a] = sa * S2;
  n[b] = sb * S2;
  RHOMBI.push({ n, d: 1 });
}
// Triangles sit a little further out: (3 + √2) / √3 against 1 + √2 for the squares.
const TRI = (3 + Math.SQRT2) / Math.sqrt(3) / (1 + Math.SQRT2);
for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) RHOMBI.push({ n: [x * S3, y * S3, z * S3], d: TRI });

/**
 * Smooth rhombicuboctahedron: the intersection of its face planes, with a
 * soft maximum so every edge and corner is gently rounded.
 */
export function sdRhombi(x: number, y: number, z: number, size: number, soft: number) {
  // Log-sum-exp soft maximum of the plane distances.
  let m = -Infinity;
  const ds: number[] = [];
  for (const f of RHOMBI) {
    const d = x * f.n[0] + y * f.n[1] + z * f.n[2] - f.d * size;
    ds.push(d);
    if (d > m) m = d;
  }
  let sum = 0;
  for (const d of ds) sum += Math.exp((d - m) / soft);
  return m + soft * Math.log(sum) - soft * 0.9;
}

/** Rounded box: half extents b, edge radius r. */
function sdRoundBox(x: number, y: number, z: number, b: number, r: number) {
  const qx = Math.abs(x) - b + r, qy = Math.abs(y) - b + r, qz = Math.abs(z) - b + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
}

/**
 * A diamond with volume: a rhombic bipyramid (a stretched octahedron). The
 * outline is a diamond (half diagonals a, b); each large face rises to a
 * point at half-thickness c. Eight face planes meet under a soft maximum, so
 * the edges stay crisp but gently rounded.
 */
function sdDiamond(x: number, y: number, z: number, a: number, b: number, c: number, soft: number) {
  const ax = Math.abs(x) / a, ay = Math.abs(y) / b, az = Math.abs(z) / c;
  // Single face plane in the positive octant: x/a + y/b + z/c = 1 (by symmetry).
  const k = 1 / Math.sqrt(1 / (a * a) + 1 / (b * b) + 1 / (c * c));
  const face = (ax + ay + az - 1) * k;
  // Soften the edges and points by blending with the neighbouring faces.
  const fx = (-ax + ay + az - 1) * k, fy = (ax - ay + az - 1) * k, fz = (ax + ay - az - 1) * k;
  const m = Math.max(face, fx, fy, fz);
  const sum = Math.exp((face - m) / soft) + Math.exp((fx - m) / soft) + Math.exp((fy - m) / soft) + Math.exp((fz - m) / soft);
  return m + soft * Math.log(sum) - soft * 0.7;
}

/**
 * Starting shapes, as data. Add one with a key, a name, a small line icon
 * and a distance function; it appears in the Shape menu.
 */
export const SHAPES: { key: string; name: string; icon: string; sdf: (x: number, y: number, z: number) => number }[] = [
  {
    key: 'polyhedron', name: 'Polyhedron',
    icon: '<path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z"/><path d="M8 3l1 5h6l1-5M9 8 3 8M15 8l6 0M9 8v8M15 8v8M3 16h6M15 16h6M9 16l-1 5M15 16l1 5"/>',
    sdf: (x, y, z) => sdRhombi(x, y, z, 0.42, 0.009),
  },
  { key: 'sphere', name: 'Sphere', icon: '<circle cx="12" cy="12" r="9"/><path d="M3 12c3 3 15 3 18 0"/>', sdf: (x, y, z) => Math.hypot(x, y, z) - 0.5 },
  {
    key: 'cube', name: 'Cube',
    icon: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
    sdf: (x, y, z) => sdRoundBox(x, y, z, 0.42, 0.07),
  },
  { key: 'diamond', name: 'Diamond', icon: '<path d="M12 2 20 12 12 22 4 12z"/>', sdf: (x, y, z) => sdDiamond(x, y, z, 0.5, 0.72, 0.34, 0.012) },
];
export const DEFAULT_SHAPE = 'polyhedron';

/**
 * Fill the volume with a starting shape. `seed` varies proportions slightly
 * for generated samples; 0 gives the shape as designed.
 */
export function fillLump(vol: Volume, seed = 0, shape = DEFAULT_SHAPE) {
  const r = rng(seed || 1);
  const v = seed ? 0.14 : 0;
  const sx = 1 + (r() - 0.5) * v * 2, sy = 1 + (r() - 0.5) * v * 2, sz = 1 + (r() - 0.5) * v * 2;
  const f = (SHAPES.find((s) => s.key === shape) ?? SHAPES[0]).sdf;
  vol.fill((x, y, z) => f(x / sx, y / sy, z / sz) * Math.min(sx, sy, sz));
}

// ───────────── Samples ─────────────

/** Families of generated forms. Each has a gesture and a material family. */
export const ARCHETYPES = {
  urchin: { materials: ['chrome', 'ultraviolet'] },
  coral: { materials: ['lime', 'opal'] },
  porous: { materials: ['mercury', 'obsidian', 'aqua'] },
  bud: { materials: ['pearl', 'opal', 'lime'] },
} as const;
export type Archetype = keyof typeof ARCHETYPES;

/** Distance from the centre to the surface along a unit direction. */
function surfaceAlong(vol: Volume, d: Vector3) {
  let lo = 0, hi = 0.93;
  for (let i = 0; i < 20; i++) {
    const m = (lo + hi) / 2;
    if (vol.sample(d.x * m, d.y * m, d.z * m) < 0) lo = m;
    else hi = m;
  }
  return lo;
}

function randomDir(r: () => number, out = new Vector3()) {
  const u = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
  return out.set(Math.cos(a) * s, u, Math.sin(a) * s);
}

/** Grow one stroke out of the surface along `dir` (optionally bending). */
function grow(vol: Volume, dir: Vector3, len: number, r: number, profile: Profile, bend?: Vector3) {
  const d = dir.clone().normalize();
  const P = d.clone().multiplyScalar(surfaceAlong(vol, d));
  const start = P.clone().addScaledVector(d, -r * 0.9);
  const end = P.clone().addScaledVector(d, len);
  if (bend) end.addScaledVector(bend, len * 0.5);
  const ctrl = P.clone().addScaledVector(d, len * 0.55);
  const path: Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12, u = 1 - t;
    path.push(new Vector3().addScaledVector(start, u * u).addScaledVector(ctrl, 2 * u * t).addScaledVector(end, t * t));
  }
  const id = vol.beginStroke();
  vol.setStroke(id, { path, radii: taper(path.length, r, profile), sign: 1, blend: r * profile.blend });
  vol.endStroke(id);
}

/** Bore a smooth hole straight through the form. */
function pierce(vol: Volume, dir: Vector3, offset: Vector3, r: number) {
  const a = dir.clone().multiplyScalar(-1.1).add(offset);
  const b = dir.clone().multiplyScalar(1.1).add(offset);
  vol.capsule(a, b, r, r, 0.05, -1, 0.15, 0);
}

/** Generate one sample of a family. Returns its material. */
export function sculptSample(vol: Volume, kind: Archetype, seed: number): string {
  fillLump(vol, seed);
  const r = rng(seed * 7 + 3);
  const dir = new Vector3(), side = new Vector3();
  if (kind === 'urchin') {
    const n = 6 + Math.floor(r() * 5);
    for (let i = 0; i < n; i++) grow(vol, randomDir(r, dir), 0.22 + r() * 0.2, 0.06 + r() * 0.035, SPIKE);
  } else if (kind === 'coral') {
    const n = 3 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      randomDir(r, dir);
      side.crossVectors(dir, randomDir(r, new Vector3())).normalize();
      grow(vol, dir, 0.2 + r() * 0.22, 0.09 + r() * 0.05, ROUNDED, side);
    }
  } else if (kind === 'porous') {
    const n = 2 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const off = randomDir(r, new Vector3()).multiplyScalar(r() * 0.18);
      pierce(vol, randomDir(r, dir), off, 0.08 + r() * 0.05);
    }
    for (let i = 0; i < 3; i++) vol.smooth(randomDir(r, dir).multiplyScalar(0.3), 0.3, 0.5);
  } else {
    // Bud: one or two generous rounded lobes and a small opening.
    const n = 1 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) grow(vol, randomDir(r, dir), 0.25 + r() * 0.15, 0.15 + r() * 0.05, ROUNDED);
    if (r() > 0.4) pierce(vol, randomDir(r, dir), new Vector3(), 0.07);
  }
  vol.heat.fill(0);
  const mats = ARCHETYPES[kind].materials;
  return mats[Math.floor(r() * mats.length)];
}
