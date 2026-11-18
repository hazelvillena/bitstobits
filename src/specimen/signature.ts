import type { Volume } from '../sculpt/volume';
import type { MeshData } from './mesher';
import type { TraitKey } from '../ui/tokens';

export type Signature = Record<TraitKey, number>; // each 0..1
export interface SignatureRaw {
  volume: number;
  area: number;
  holes: number;
}

export const TRAITS: TraitKey[] = ['genus', 'sphericity', 'elongation', 'concavity', 'roughness', 'compression', 'volume'];
export const WEIGHTS: Record<TraitKey, number> = {
  genus: 1.4, sphericity: 1, elongation: 1, concavity: 0.8, roughness: 0.8, compression: 0.8, volume: 0.6,
};

/** Measure a form. Everything is normalised to 0..1 so traits compare fairly. */
export function measure(vol: Volume, mesh: MeshData): { sig: Signature; raw: SignatureRaw } {
  const { n, sdf, h } = vol;
  // Volume + principal axes from inside voxels.
  let count = 0, mx = 0, my = 0, mz = 0;
  const pts: number[] = [];
  for (let k = 0; k < n; k += 2)
    for (let j = 0; j < n; j += 2)
      for (let i = 0; i < n; i += 2) {
        if (sdf[i + n * (j + n * k)] < 0) {
          const x = -1 + i * h, y = -1 + j * h, z = -1 + k * h;
          pts.push(x, y, z);
          mx += x; my += y; mz += z;
          count++;
        }
      }
  const V = count * Math.pow(h * 2, 3);
  mx /= count || 1; my /= count || 1; mz /= count || 1;
  const cov = [0, 0, 0, 0, 0, 0]; // xx yy zz xy xz yz
  for (let p = 0; p < pts.length; p += 3) {
    const x = pts[p] - mx, y = pts[p + 1] - my, z = pts[p + 2] - mz;
    cov[0] += x * x; cov[1] += y * y; cov[2] += z * z;
    cov[3] += x * y; cov[4] += x * z; cov[5] += y * z;
  }
  const eig = symmetricEigenvalues(cov.map((c) => c / (count || 1)));

  // Surface area.
  const P = mesh.positions, I = mesh.indices;
  let A = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    A += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }

  const holes = genus(mesh);

  // Curvature statistics.
  const cv = mesh.curvature;
  let neg = 0, mean = 0;
  for (const c of cv) {
    mean += c;
    if (c < -0.08) neg++;
  }
  mean /= cv.length || 1;
  let varc = 0;
  for (const c of cv) varc += (c - mean) ** 2;
  const rough = Math.sqrt(varc / (cv.length || 1));

  let compMean = 0;
  for (const c of mesh.compression) compMean += c;
  compMean /= mesh.compression.length || 1;

  const sphericity = A > 0 ? (Math.cbrt(Math.PI) * Math.pow(6 * V, 2 / 3)) / A : 0;
  const elong = eig[0] > 0 ? 1 - Math.sqrt(eig[2] / eig[0]) : 0;

  const sig: Signature = {
    genus: Math.min(holes, 4) / 4,
    sphericity: clamp((sphericity - 0.55) / 0.45),
    elongation: clamp((elong - 0.05) / 0.6),
    concavity: clamp((neg / (cv.length || 1)) * 2.5),
    roughness: clamp((rough - 0.15) / 0.9),
    compression: clamp((compMean - 0.35) / 0.4),
    volume: clamp((V - 0.15) / 0.75),
  };
  return { sig, raw: { volume: V, area: A, holes } };
}

/** Holes from the Euler characteristic of each closed component. */
function genus(mesh: MeshData) {
  const I = mesh.indices;
  const nv = mesh.positions.length / 3;
  const parent = new Int32Array(nv).map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const edges = new Set<number>();
  for (let t = 0; t < I.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = I[t + e], b = I[t + ((e + 1) % 3)];
      edges.add(a < b ? a * nv + b : b * nv + a);
      parent[find(a)] = find(b);
    }
  }
  const used = new Set<number>();
  for (let t = 0; t < I.length; t++) used.add(I[t]);
  const comps = new Set<number>();
  for (const v of used) comps.add(find(v));
  const chi = used.size - edges.size + I.length / 3;
  return Math.max(0, Math.round((2 * comps.size - chi) / 2));
}

function symmetricEigenvalues([a, d, f, b, c, e]: number[]) {
  // Matrix [[a,b,c],[b,d,e],[c,e,f]], closed form (Smith 1961).
  const p1 = b * b + c * c + e * e;
  if (p1 < 1e-12) return [a, d, f].sort((x, y) => y - x);
  const q = (a + d + f) / 3;
  const p2 = (a - q) ** 2 + (d - q) ** 2 + (f - q) ** 2 + 2 * p1;
  const p = Math.sqrt(p2 / 6);
  const B = [(a - q) / p, b / p, c / p, (d - q) / p, e / p, (f - q) / p];
  const detB = B[0] * (B[3] * B[5] - B[4] * B[4]) - B[1] * (B[1] * B[5] - B[4] * B[2]) + B[2] * (B[1] * B[4] - B[3] * B[2]);
  const r = Math.max(-1, Math.min(1, detB / 2));
  const phi = Math.acos(r) / 3;
  const e1 = q + 2 * p * Math.cos(phi);
  const e3 = q + 2 * p * Math.cos(phi + (2 * Math.PI) / 3);
  return [e1, 3 * q - e1 - e3, e3];
}

const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ───── Kinship ─────

export function kinship(a: Signature, b: Signature) {
  let s = 0, w = 0;
  for (const t of TRAITS) {
    s += WEIGHTS[t] * (a[t] - b[t]) ** 2;
    w += WEIGHTS[t];
  }
  const d = Math.sqrt(s / w);
  return Math.exp(-((d / 0.17) ** 2));
}

/** The traits two forms share most distinctively, best first. */
export function sharedTraits(a: Signature, b: Signature, population: Signature[]) {
  const mean = {} as Record<TraitKey, number>;
  for (const t of TRAITS) mean[t] = population.reduce((s, p) => s + p[t], 0) / (population.length || 1);
  return TRAITS.map((t) => {
    const closeness = 1 - Math.min(1, Math.abs(a[t] - b[t]) / 0.12);
    const distinct = Math.abs((a[t] + b[t]) / 2 - mean[t]) + 0.15;
    // Sharing an absence (no openings at all) explains little.
    const absent = t === 'genus' && a[t] === 0 && b[t] === 0 ? 0.15 : 1;
    return { trait: t, score: closeness * distinct * WEIGHTS[t] * absent };
  })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score);
}
