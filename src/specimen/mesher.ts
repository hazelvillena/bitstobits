import type { Volume } from '../sculpt/volume';

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  curvature: Float32Array; // per vertex, signed (convex > 0)
  compression: Float32Array;
  indices: Uint32Array;
}

/**
 * Naive surface nets: one vertex per surface-crossing cell, placed at the
 * mean of its edge crossings; quads across every sign-changing edge.
 */
export function meshVolume(vol: Volume): MeshData {
  const { n, sdf, h } = vol;
  const nn = n * n;
  const cellIndex = new Int32Array(n * n * n).fill(-1);
  const pos: number[] = [];
  const nor: number[] = [];
  const curv: number[] = [];
  const comp: number[] = [];

  const corners = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
    [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ];
  const edges = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const v = new Float32Array(8);

  for (let k = 0; k < n - 1; k++)
    for (let j = 0; j < n - 1; j++)
      for (let i = 0; i < n - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const [a, b, d] = corners[c];
          v[c] = sdf[i + a + n * (j + b) + nn * (k + d)];
          if (v[c] < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, cnt = 0;
        for (const [a, b] of edges) {
          const va = v[a], vb = v[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          const A = corners[a], B = corners[b];
          sx += A[0] + (B[0] - A[0]) * t;
          sy += A[1] + (B[1] - A[1]) * t;
          sz += A[2] + (B[2] - A[2]) * t;
          cnt++;
        }
        const x = -1 + (i + sx / cnt) * h, y = -1 + (j + sy / cnt) * h, z = -1 + (k + sz / cnt) * h;
        cellIndex[i + n * j + nn * k] = pos.length / 3;
        pos.push(x, y, z);

        // Normal + Laplacian from the field.
        const e = h;
        const c0 = vol.sample(x, y, z);
        const xp = vol.sample(x + e, y, z), xn = vol.sample(x - e, y, z);
        const yp = vol.sample(x, y + e, z), yn = vol.sample(x, y - e, z);
        const zp = vol.sample(x, y, z + e), zn = vol.sample(x, y, z - e);
        let gx = xp - xn, gy = yp - yn, gz = zp - zn;
        const gl = Math.hypot(gx, gy, gz) || 1;
        gx /= gl; gy /= gl; gz /= gl;
        nor.push(gx, gy, gz);
        const lap = (xp + xn + yp + yn + zp + zn - 6 * c0) / (e * e);
        curv.push(Math.max(-1.5, Math.min(1.5, lap * 0.09)));
        comp.push(vol.sampleComp(x, y, z));
      }

  // Quads: for each grid edge with a sign change, join the 4 cells around it.
  const idx: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, c, b, b, c, d);
    else idx.push(a, b, c, b, d, c);
  };
  const C = (i: number, j: number, k: number) => cellIndex[i + n * j + nn * k];
  for (let k = 1; k < n - 1; k++)
    for (let j = 1; j < n - 1; j++)
      for (let i = 1; i < n - 1; i++) {
        const p = i + n * j + nn * k;
        const s0 = sdf[p] < 0;
        if (s0 !== sdf[p + 1] < 0) quad(C(i, j - 1, k - 1), C(i, j, k - 1), C(i, j - 1, k), C(i, j, k), !s0);
        if (s0 !== sdf[p + n] < 0) quad(C(i - 1, j, k - 1), C(i - 1, j, k), C(i, j, k - 1), C(i, j, k), !s0);
        if (s0 !== sdf[p + nn] < 0) quad(C(i - 1, j - 1, k), C(i, j - 1, k), C(i - 1, j, k), C(i, j, k), s0);
      }

  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nor),
    curvature: new Float32Array(curv),
    compression: new Float32Array(comp),
    indices: new Uint32Array(idx),
  };
}
