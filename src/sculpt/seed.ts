import { Vector3 } from 'three';
import { Volume, smin } from './volume';

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/**
 * The starting lump: a few attractor points amalgamated into one field
 * (attractor points → field → amalgamation, as in the reference plate).
 */
export function fillLump(vol: Volume, seed: number) {
  const r = rng(seed);
  const pts: { c: [number, number, number]; r: number }[] = [];
  const count = 4 + Math.floor(r() * 3);
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2, b = (r() - 0.5) * 1.6;
    const d = i === 0 ? 0 : 0.18 + r() * 0.16;
    pts.push({
      c: [Math.cos(a) * Math.cos(b) * d, Math.sin(b) * d * 0.9, Math.sin(a) * Math.cos(b) * d],
      r: i === 0 ? 0.36 : 0.2 + r() * 0.14,
    });
  }
  const f1 = 2.1 + r(), f2 = 3.3 + r();
  vol.fill((x, y, z) => {
    let d = 10;
    for (const p of pts) {
      const dx = x - p.c[0], dy = y - p.c[1], dz = z - p.c[2];
      d = smin(d, Math.sqrt(dx * dx + dy * dy + dz * dz) - p.r, 0.22);
    }
    // Low-frequency organic undulation.
    d += 0.018 * Math.sin(x * f1 * 3 + y * 2.1) * Math.sin(z * f2 * 2 + x * 1.3);
    return d;
  });
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
