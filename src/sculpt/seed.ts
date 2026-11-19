import { Vector3 } from 'three';
import { Volume } from './volume';

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

/**
 * The starting form: a smooth rhombicuboctahedron (squares and triangles,
 * softly rounded). `seed` varies proportions slightly for generated samples.
 */
export function fillLump(vol: Volume, seed = 0) {
  const r = rng(seed || 1);
  const v = seed ? 0.14 : 0;
  const sx = 1 + (r() - 0.5) * v * 2, sy = 1 + (r() - 0.5) * v * 2, sz = 1 + (r() - 0.5) * v * 2;
  vol.fill((x, y, z) => sdRhombi(x / sx, y / sy, z / sz, 0.42, 0.009) * Math.min(sx, sy, sz));
}

/** Procedurally "sculpt" a specimen, for seeding the field without hands. */
export function sculptRandom(vol: Volume, seed: number) {
  fillLump(vol, seed);
  const r = rng(seed * 7 + 3);
  const a = new Vector3(), b = new Vector3(), dir = new Vector3();
  const style = r();

  // Pulls: tendrils outward.
  const pulls = style < 0.4 ? 1 + Math.floor(r() * 3) : Math.floor(r() * 2);
  for (let i = 0; i < pulls; i++) {
    dir.set(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
    a.copy(dir).multiplyScalar(0.3);
    b.copy(dir).multiplyScalar(0.6 + r() * 0.22);
    vol.capsule(a, b, 0.15, 0.07 + r() * 0.05, 0.08, 1, -0.25, 0);
  }
  // Drills: apertures through the mass.
  const drills = style > 0.55 ? 1 + Math.floor(r() * 3) : Math.floor(r() * 1.4);
  for (let i = 0; i < drills; i++) {
    dir.set(r() - 0.5, (r() - 0.5) * 0.6, r() - 0.5).normalize();
    const off = new Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(0.25);
    a.copy(dir).multiplyScalar(-1.1).add(off);
    b.copy(dir).multiplyScalar(1.1).add(off);
    vol.capsule(a, b, 0.07 + r() * 0.04, 0.07 + r() * 0.04, 0.03, -1, 0.15, 0);
  }
  // Presses: flattening and densifying.
  const presses = Math.floor(r() * 3);
  for (let i = 0; i < presses; i++) {
    dir.set(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
    a.copy(dir).multiplyScalar(0.62);
    vol.sphere(a, 0.24, 0.12, -1, 0.45);
  }
  // A little smoothing.
  for (let i = 0; i < 4; i++) {
    a.set(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(0.8);
    vol.smooth(a, 0.35, 0.6);
  }
  vol.heat.fill(0);
}
