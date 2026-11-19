import type { Vector3 } from 'three';

/**
 * Signed distance primitives and blends, shared by brushes and strokes.
 * Distances are in object units; negative is inside.
 */

/** Polynomial smooth minimum: a fillet of width k between two shapes. */
export function smin(a: number, b: number, k: number) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** Smooth maximum: a softened subtraction when used as smax(a, -b, k). */
export function smax(a: number, b: number, k: number) {
  return -smin(-a, -b, k);
}

export function sdCapsule(px: number, py: number, pz: number, a: Vector3, b: Vector3, r: number) {
  const bx = b.x - a.x, by = b.y - a.y, bz = b.z - a.z;
  const qx = px - a.x, qy = py - a.y, qz = pz - a.z;
  const t = Math.min(1, Math.max(0, (qx * bx + qy * by + qz * bz) / (bx * bx + by * by + bz * bz || 1e-9)));
  const dx = qx - bx * t, dy = qy - by * t, dz = qz - bz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}

/**
 * Round cone between spheres (a, r1) and (b, r2): exact distance
 * (after Inigo Quilez). Chained along a path it makes a smooth taper.
 */
export function sdRoundCone(px: number, py: number, pz: number, a: Vector3, b: Vector3, r1: number, r2: number) {
  const bax = b.x - a.x, bay = b.y - a.y, baz = b.z - a.z;
  const l2 = bax * bax + bay * bay + baz * baz;
  if (l2 < 1e-10) {
    const dx = px - a.x, dy = py - a.y, dz = pz - a.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) - Math.max(r1, r2);
  }
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const pax = px - a.x, pay = py - a.y, paz = pz - a.z;
  const y = pax * bax + pay * bay + paz * baz;
  const z = y - l2;
  const qx = pax * l2 - bax * y, qy = pay * l2 - bay * y, qz = paz * l2 - baz * y;
  const x2 = qx * qx + qy * qy + qz * qz;
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

/** A tapered sweep: round cones through path[i] with radius radii[i]. */
export function sdSweep(px: number, py: number, pz: number, path: Vector3[], radii: number[]) {
  let d = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    d = Math.min(d, sdRoundCone(px, py, pz, path[i], path[i + 1], radii[i], radii[i + 1]));
  }
  return d;
}

/** Axis-aligned bounds of a sweep, padded. */
export function sweepBounds(path: Vector3[], radii: number[], pad: number) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  path.forEach((q, i) => {
    const r = radii[i] + pad;
    min[0] = Math.min(min[0], q.x - r); max[0] = Math.max(max[0], q.x + r);
    min[1] = Math.min(min[1], q.y - r); max[1] = Math.max(max[1], q.y + r);
    min[2] = Math.min(min[2], q.z - r); max[2] = Math.max(max[2], q.z + r);
  });
  return { min, max };
}
