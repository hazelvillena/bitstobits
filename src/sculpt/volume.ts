import {
  Data3DTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  RedFormat,
  RGFormat,
  UnsignedByteType,
  ClampToEdgeWrapping,
  Vector3,
} from 'three';

/**
 * Signed distance field volume over object space [-1, 1]^3.
 * The Float32 field is the source of truth; GPU textures mirror it
 * (R16F distance + RG8 attributes: compression, heat).
 */
export class Volume {
  readonly n: number;
  readonly h: number; // voxel size in object units
  readonly sdf: Float32Array;
  readonly comp: Float32Array; // 0 stretched … 0.5 neutral … 1 compressed
  readonly heat: Float32Array; // recency of touch, decays

  readonly sdfTex: Data3DTexture;
  readonly attrTex: Data3DTexture;
  private sdfHalf: Uint16Array;
  private attr8: Uint8Array;

  private sdfDirty = false;
  private attrDirty = false;
  // Bounding box of voxels with heat > 0 (for cheap decay).
  private hotMin = [Infinity, Infinity, Infinity];
  private hotMax = [-Infinity, -Infinity, -Infinity];

  static readonly LIMIT = 0.93; // matter is contained inside this cube

  constructor(n = 96) {
    this.n = n;
    this.h = 2 / (n - 1);
    const count = n * n * n;
    this.sdf = new Float32Array(count).fill(1);
    this.comp = new Float32Array(count).fill(0.5);
    this.heat = new Float32Array(count);
    this.sdfHalf = new Uint16Array(count);
    this.attr8 = new Uint8Array(count * 2);

    this.sdfTex = new Data3DTexture(this.sdfHalf, n, n, n);
    this.sdfTex.format = RedFormat;
    this.sdfTex.type = HalfFloatType;
    this.attrTex = new Data3DTexture(this.attr8, n, n, n);
    this.attrTex.format = RGFormat;
    this.attrTex.type = UnsignedByteType;
    for (const t of [this.sdfTex, this.attrTex]) {
      t.minFilter = t.magFilter = LinearFilter;
      t.wrapS = t.wrapT = t.wrapR = ClampToEdgeWrapping;
      t.unpackAlignment = 1;
      t.generateMipmaps = false;
    }
  }

  idx(i: number, j: number, k: number) {
    return i + this.n * (j + this.n * k);
  }
  coord(i: number) {
    return -1 + i * this.h;
  }

  /** Fill the whole field from a distance function. */
  fill(fn: (x: number, y: number, z: number) => number) {
    const { n } = this;
    let p = 0;
    for (let k = 0; k < n; k++) {
      const z = this.coord(k);
      for (let j = 0; j < n; j++) {
        const y = this.coord(j);
        for (let i = 0; i < n; i++, p++) {
          const x = this.coord(i);
          const box = Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) - Volume.LIMIT;
          this.sdf[p] = Math.max(fn(x, y, z), box);
        }
      }
    }
    this.comp.fill(0.5);
    this.heat.fill(0);
    this.hotMin = [Infinity, Infinity, Infinity];
    this.hotMax = [-Infinity, -Infinity, -Infinity];
    this.syncAll();
  }

  copyFrom(other: Volume) {
    this.sdf.set(other.sdf);
    this.comp.set(other.comp);
    this.heat.set(other.heat);
    this.syncAll();
  }

  private syncAll() {
    const count = this.sdf.length;
    for (let p = 0; p < count; p++) {
      this.sdfHalf[p] = DataUtils.toHalfFloat(this.sdf[p]);
      this.attr8[p * 2] = this.comp[p] * 255;
      this.attr8[p * 2 + 1] = this.heat[p] * 255;
    }
    this.sdfDirty = this.attrDirty = true;
  }

  // ───────────── Sampling ─────────────

  /** Trilinear sample of the distance field at an object-space point. */
  sample(x: number, y: number, z: number): number {
    return this.sampleOf(this.sdf, x, y, z);
  }
  sampleComp(x: number, y: number, z: number): number {
    return this.sampleOf(this.comp, x, y, z);
  }
  private sampleOf(s: Float32Array, x: number, y: number, z: number): number {
    const { n } = this;
    const fx = Math.min(Math.max((x + 1) / this.h, 0), n - 1.001);
    const fy = Math.min(Math.max((y + 1) / this.h, 0), n - 1.001);
    const fz = Math.min(Math.max((z + 1) / this.h, 0), n - 1.001);
    const i = fx | 0, j = fy | 0, k = fz | 0;
    const u = fx - i, v = fy - j, w = fz - k;
    const p = this.idx(i, j, k);
    const nn = n * n;
    const c00 = s[p] * (1 - u) + s[p + 1] * u;
    const c10 = s[p + n] * (1 - u) + s[p + n + 1] * u;
    const c01 = s[p + nn] * (1 - u) + s[p + nn + 1] * u;
    const c11 = s[p + nn + n] * (1 - u) + s[p + nn + n + 1] * u;
    return (c00 * (1 - v) + c10 * v) * (1 - w) + (c01 * (1 - v) + c11 * v) * w;
  }

  gradient(p: Vector3, out: Vector3): Vector3 {
    const e = this.h;
    out.set(
      this.sample(p.x + e, p.y, p.z) - this.sample(p.x - e, p.y, p.z),
      this.sample(p.x, p.y + e, p.z) - this.sample(p.x, p.y - e, p.z),
      this.sample(p.x, p.y, p.z + e) - this.sample(p.x, p.y, p.z - e),
    );
    return out.lengthSq() > 1e-12 ? out.normalize() : out.set(0, 1, 0);
  }

  /** Sphere-trace a ray in object space. Returns distance or -1. */
  raycast(ro: Vector3, rd: Vector3, maxT = 6): number {
    // Enter the unit cube first.
    let t0 = 0, t1 = maxT;
    for (const a of ['x', 'y', 'z'] as const) {
      const inv = 1 / (rd[a] || 1e-9);
      let ta = (-1 - ro[a]) * inv, tb = (1 - ro[a]) * inv;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
    }
    if (t0 > t1) return -1;
    let t = t0;
    for (let s = 0; s < 160 && t < t1; s++) {
      const d = this.sample(ro.x + rd.x * t, ro.y + rd.y * t, ro.z + rd.z * t);
      if (d < 0.002) return t;
      t += Math.max(d * 0.9, 0.004);
    }
    return -1;
  }

  // ───────────── Brushes ─────────────

  private region(cx: number, cy: number, cz: number, r: number, fn: (p: number, x: number, y: number, z: number) => void) {
    this.regionBox([cx - r, cy - r, cz - r], [cx + r, cy + r, cz + r], fn);
  }

  /** Visit every voxel inside an object-space box. */
  private regionBox(min: number[], max: number[], fn: (p: number, x: number, y: number, z: number) => void) {
    const { n, h } = this;
    const lo = (c: number) => Math.max(1, Math.floor((c + 1) / h));
    const hi = (c: number) => Math.min(n - 2, Math.ceil((c + 1) / h));
    const i0 = lo(min[0]), i1 = hi(max[0]), j0 = lo(min[1]), j1 = hi(max[1]), k0 = lo(min[2]), k1 = hi(max[2]);
    for (let k = k0; k <= k1; k++) {
      const z = this.coord(k);
      for (let j = j0; j <= j1; j++) {
        const y = this.coord(j);
        let p = this.idx(i0, j, k);
        for (let i = i0; i <= i1; i++, p++) fn(p, this.coord(i), y, z);
      }
    }
    // Track hot region and upload marks.
    this.hotMin = [Math.min(this.hotMin[0], i0), Math.min(this.hotMin[1], j0), Math.min(this.hotMin[2], k0)];
    this.hotMax = [Math.max(this.hotMax[0], i1), Math.max(this.hotMax[1], j1), Math.max(this.hotMax[2], k1)];
    this.sdfDirty = this.attrDirty = true;
  }

  private writeVoxel(p: number) {
    this.sdfHalf[p] = DataUtils.toHalfFloat(this.sdf[p]);
    this.attr8[p * 2] = this.comp[p] * 255;
    this.attr8[p * 2 + 1] = this.heat[p] * 255;
  }

  /**
   * Smoothly union (sign=+1) or subtract (sign=-1) a tapered capsule a→b.
   * `compDelta` shifts compression near the affected surface.
   */
  capsule(a: Vector3, b: Vector3, ra: number, rb: number, k: number, sign: 1 | -1, compDelta = 0, heat = 1) {
    const bax = b.x - a.x, bay = b.y - a.y, baz = b.z - a.z;
    const baba = bax * bax + bay * bay + baz * baz || 1e-9;
    const r = Math.max(ra, rb) + k + 0.06;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, mz = (a.z + b.z) / 2;
    const reach = Math.sqrt(baba) / 2 + r;
    const L = Volume.LIMIT;
    this.region(mx, my, mz, reach, (p, x, y, z) => {
      const pax = x - a.x, pay = y - a.y, paz = z - a.z;
      const t = Math.min(Math.max((pax * bax + pay * bay + paz * baz) / baba, 0), 1);
      const dx = pax - bax * t, dy = pay - bay * t, dz = paz - baz * t;
      const cap = Math.sqrt(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * t);
      const d0 = this.sdf[p];
      let d: number;
      if (sign > 0) d = smin(d0, cap, k);
      else d = smax(d0, -cap, k);
      const box = Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) - L;
      d = Math.max(d, box);
      const changed = Math.abs(d - d0);
      this.sdf[p] = d;
      // Attributes live in a shell around the new surface.
      const near = Math.max(0, 1 - Math.abs(d) / 0.12);
      const influence = Math.max(0, 1 - Math.max(cap, 0) / (k + 0.1));
      if (near > 0 && influence > 0) {
        if (compDelta) this.comp[p] = clamp01(this.comp[p] + compDelta * influence * near);
        this.heat[p] = Math.max(this.heat[p], heat * influence * near);
      }
      if (changed > 0 || near > 0) this.writeVoxel(p);
    });
  }

  sphere(c: Vector3, r: number, k: number, sign: 1 | -1, compDelta = 0) {
    this.capsule(c, c, r, r, k, sign, compDelta);
  }

  /** Relax the surface toward the local average (a soft blur brush). */
  smooth(c: Vector3, r: number, amount: number) {
    const { n } = this;
    const nn = n * n;
    const s = this.sdf;
    const tmp: number[] = [];
    const idxs: number[] = [];
    this.region(c.x, c.y, c.z, r, (p, x, y, z) => {
      const dx = x - c.x, dy = y - c.y, dz = z - c.z;
      const f = 1 - Math.sqrt(dx * dx + dy * dy + dz * dz) / r;
      if (f <= 0) return;
      const avg = (s[p - 1] + s[p + 1] + s[p - n] + s[p + n] + s[p - nn] + s[p + nn]) / 6;
      tmp.push(s[p] + (avg - s[p]) * amount * f * f);
      idxs.push(p);
      this.heat[p] = Math.max(this.heat[p], 0.5 * f);
      this.comp[p] += (0.5 - this.comp[p]) * 0.04 * f;
    });
    for (let q = 0; q < idxs.length; q++) {
      s[idxs[q]] = tmp[q];
      this.writeVoxel(idxs[q]);
    }
  }

  /** Decay heat. Cheap: only walks the hot bounding box. */
  cool(dt: number) {
    if (this.hotMin[0] === Infinity) return;
    const decay = Math.exp(-dt * 0.9);
    const [i0, j0, k0] = this.hotMin, [i1, j1, k1] = this.hotMax;
    let any = false;
    for (let k = k0; k <= k1; k++)
      for (let j = j0; j <= j1; j++) {
        let p = this.idx(i0, j, k);
        for (let i = i0; i <= i1; i++, p++) {
          const v = this.heat[p];
          if (v > 0) {
            const nv = v < 0.01 ? 0 : v * decay;
            this.heat[p] = nv;
            this.attr8[p * 2 + 1] = nv * 255;
            any = true;
          }
        }
      }
    this.attrDirty = true;
    if (!any) {
      this.hotMin = [Infinity, Infinity, Infinity];
      this.hotMax = [-Infinity, -Infinity, -Infinity];
    }
  }

  // ───────────── Extrude (face) ─────────────
  private snapSdf: Float32Array | null = null;
  private snapComp: Float32Array | null = null;
  private strokeMin = [0, 0, 0];
  private strokeMax = [0, 0, 0];
  private stroking = false;

  /** Freeze the form at the start of a stroke. Strokes rebuild from this. */
  beginStroke() {
    if (!this.snapSdf) {
      this.snapSdf = new Float32Array(this.sdf.length);
      this.snapComp = new Float32Array(this.comp.length);
    }
    this.snapSdf.set(this.sdf);
    this.snapComp!.set(this.comp);
    this.strokeMin = [Infinity, Infinity, Infinity];
    this.strokeMax = [-Infinity, -Infinity, -Infinity];
    this.stroking = true;
  }
  endStroke() {
    this.stroking = false;
  }

  /**
   * Extrude (sign +1) or inset (sign -1) a rounded face swept along `path`.
   * Rebuilt from the stroke snapshot every call, so the result is always the
   * clean original plus exactly one extrusion: moving back undoes it, and
   * nothing accumulates. The last segment's end is a flat face that points
   * along the direction of travel.
   */
  extrude(path: Vector3[], r: number, sign: 1 | -1) {
    if (!this.stroking || !this.snapSdf || path.length < 2) return;
    const snap = this.snapSdf, snapC = this.snapComp!;
    const k = sign > 0 ? r * 0.75 : r * 0.35; // soft fillet into the body
    const re = r * 0.38; // edge rounding of the face
    const pad = r + k + this.h * 2;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const q of path) {
      mn[0] = Math.min(mn[0], q.x - pad); mx[0] = Math.max(mx[0], q.x + pad);
      mn[1] = Math.min(mn[1], q.y - pad); mx[1] = Math.max(mx[1], q.y + pad);
      mn[2] = Math.min(mn[2], q.z - pad); mx[2] = Math.max(mx[2], q.z + pad);
    }
    // Visit the union with everything this stroke has touched, so shrinking restores.
    for (let a = 0; a < 3; a++) {
      this.strokeMin[a] = Math.min(this.strokeMin[a], mn[a]);
      this.strokeMax[a] = Math.max(this.strokeMax[a], mx[a]);
    }
    const L = Volume.LIMIT;
    const compShift = sign > 0 ? -0.22 : 0.3;
    const segK = r * 0.3;
    this.regionBox(this.strokeMin, this.strokeMax, (p, x, y, z) => {
      let shape = Infinity;
      for (let s = 0; s < path.length - 1; s++) {
        const d = sdRoundCylinder(x, y, z, path[s], path[s + 1], r, re);
        shape = s === 0 ? d : smin(shape, d, segK);
      }
      const d0 = snap[p];
      let d = sign > 0 ? smin(d0, shape, k) : smax(d0, -shape, k);
      d = Math.max(d, Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) - L);
      this.sdf[p] = d;
      const infl = Math.max(0, 1 - Math.max(shape, 0) / (k + 0.04));
      const c0 = snapC[p];
      this.comp[p] = infl > 0 ? Math.min(1, Math.max(0, c0 + compShift * infl)) : c0;
      if (infl > 0) this.heat[p] = Math.max(this.heat[p], infl * 0.7);
      this.writeVoxel(p);
    });
  }

  /** Push pending changes to the GPU. Call once per frame. */
  upload() {
    if (this.sdfDirty) {
      this.sdfTex.needsUpdate = true;
      this.sdfDirty = false;
    }
    if (this.attrDirty) {
      this.attrTex.needsUpdate = true;
      this.attrDirty = false;
    }
  }
}

/** Cylinder from a to b with radius r and rounded edges re (flat ends). */
function sdRoundCylinder(px: number, py: number, pz: number, a: Vector3, b: Vector3, r: number, re: number) {
  let ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const len = Math.sqrt(ux * ux + uy * uy + uz * uz);
  if (len < 2 * re + 1e-4) {
    const mx = (a.x + b.x) / 2 - px, my = (a.y + b.y) / 2 - py, mz = (a.z + b.z) / 2 - pz;
    return Math.sqrt(mx * mx + my * my + mz * mz) - r;
  }
  ux /= len; uy /= len; uz /= len;
  const ax = a.x + ux * re, ay = a.y + uy * re, az = a.z + uz * re;
  const H = len - 2 * re;
  const qx = px - ax, qy = py - ay, qz = pz - az;
  const t = qx * ux + qy * uy + qz * uz;
  const rad = Math.sqrt(Math.max(0, qx * qx + qy * qy + qz * qz - t * t));
  const dx = rad - (r - re);
  const dy = Math.abs(t - H / 2) - H / 2;
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - re;
}

export function smin(a: number, b: number, k: number) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
export function smax(a: number, b: number, k: number) {
  return -smin(-a, -b, k);
}
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
