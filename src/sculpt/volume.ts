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
import { smax, smin, sdSweep, sweepBounds } from './sdf';

export { smin, smax } from './sdf';

/** A stroke's shape: a tapered sweep, added (+1) or carved (-1), filleted by `blend`. */
export interface StrokeShape {
  path: Vector3[];
  radii: number[];
  sign: 1 | -1;
  blend: number;
}

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
  // Dirty z-slab range (in voxel layers) for partial GPU uploads.
  private sdfK = [Infinity, -Infinity];
  private attrK = [Infinity, -Infinity];
  private coolTimer = 0;
  /**
   * Uploads a range of z-layers to the GPU. Set by the renderer; returns
   * false when the texture isn't on the GPU yet (then a full upload runs).
   */
  uploadLayers: ((tex: Data3DTexture, data: Uint16Array | Uint8Array, k0: number, k1: number, channels: number) => boolean) | null = null;
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
    this.sdfK = [0, this.n - 1];
    this.attrK = [0, this.n - 1];
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
  raycast(ro: Vector3, rd: Vector3, maxT = 100): number {
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
    this.sdfK = [Math.min(this.sdfK[0], k0), Math.max(this.sdfK[1], k1)];
    this.attrK = [Math.min(this.attrK[0], k0), Math.max(this.attrK[1], k1)];
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

  /** Decay heat, ten times a second. Only walks the hot bounding box. */
  cool(dt: number) {
    if (this.hotMin[0] === Infinity) return;
    this.coolTimer += dt;
    if (this.coolTimer < 0.1) return;
    dt = this.coolTimer;
    this.coolTimer = 0;
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
    this.attrK = [Math.min(this.attrK[0], k0), Math.max(this.attrK[1], k1)];
    if (!any) {
      this.hotMin = [Infinity, Infinity, Infinity];
      this.hotMax = [-Infinity, -Infinity, -Infinity];
    }
  }

  // ───────────── Strokes (extrude) ─────────────
  // Strokes share one session: a snapshot taken when the first stroke
  // begins. Every active (and recently ended) stroke is replayed onto that
  // snapshot each update, so two hands can extrude at once without either
  // one baking the other in twice.
  private snapSdf: Float32Array | null = null;
  private snapComp: Float32Array | null = null;
  private session = false;
  private strokes = new Map<number, { shape: StrokeShape | null; min: number[]; max: number[]; accMin: number[]; accMax: number[]; live: boolean }>();
  private strokesDirty = false;
  private nextStroke = 1;

  beginStroke(): number {
    if (!this.session) {
      if (!this.snapSdf) {
        this.snapSdf = new Float32Array(this.sdf.length);
        this.snapComp = new Float32Array(this.comp.length);
      }
      this.snapSdf.set(this.sdf);
      this.snapComp!.set(this.comp);
      this.strokes.clear();
      this.session = true;
    }
    const id = this.nextStroke++;
    this.strokes.set(id, {
      shape: null, min: [0, 0, 0], max: [0, 0, 0],
      accMin: [Infinity, Infinity, Infinity], accMax: [-Infinity, -Infinity, -Infinity], live: true,
    });
    return id;
  }

  endStroke(id: number) {
    // Apply any pending movement before this stroke stops being rebuilt.
    if (this.strokesDirty && this.session) {
      this.rebuild();
      this.strokesDirty = false;
    }
    const st = this.strokes.get(id);
    if (st) st.live = false;
    // When nobody is extruding any more, the result simply stays.
    if (![...this.strokes.values()].some((s) => s.live)) {
      this.session = false;
      this.strokes.clear();
    }
  }

  /** Undo a stroke: the area it touched returns to the snapshot. */
  cancelStroke(id: number) {
    const st = this.strokes.get(id);
    if (!st || !this.session) return;
    st.shape = null;
    this.rebuild();
    this.strokesDirty = false;
  }

  /** Set a stroke's current shape. Rebuilt once per frame in upload(). */
  setStroke(id: number, shape: StrokeShape) {
    const st = this.strokes.get(id);
    if (!st || !this.session || shape.path.length < 2) return;
    const { min, max } = sweepBounds(shape.path, shape.radii, shape.blend + this.h * 2);
    Object.assign(st, { shape, min, max });
    for (let a = 0; a < 3; a++) {
      st.accMin[a] = Math.min(st.accMin[a], min[a]);
      st.accMax[a] = Math.max(st.accMax[a], max[a]);
    }
    this.strokesDirty = true;
  }

  private rebuild() {
    const snap = this.snapSdf!, snapC = this.snapComp!;
    const list = [...this.strokes.values()].filter((s) => s.shape);
    const L = Volume.LIMIT;
    // Only areas live strokes have touched need rebuilding (including a
    // cancelled one, so its area is restored); ended strokes stay composed
    // wherever a live one overlaps them.
    for (const live of this.strokes.values()) if (live.live && live.accMin[0] !== Infinity) this.regionBox(live.accMin, live.accMax, (p, x, y, z) => {
      let d = snap[p];
      let c = snapC[p];
      let infl = 0;
      for (const st of list) {
        if (x < st.min[0] || x > st.max[0] || y < st.min[1] || y > st.max[1] || z < st.min[2] || z > st.max[2]) continue;
        const { path, radii, sign, blend } = st.shape!;
        const shape = sdSweep(x, y, z, path, radii);
        d = sign > 0 ? smin(d, shape, blend) : smax(d, -shape, blend);
        const w = Math.max(0, 1 - Math.max(shape, 0) / (blend + 0.03));
        if (w > 0) {
          c = clamp01(c + (sign > 0 ? -0.22 : 0.3) * w);
          infl = Math.max(infl, w);
        }
      }
      this.sdf[p] = Math.max(d, Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) - L);
      this.comp[p] = c;
      if (infl > 0) this.heat[p] = Math.max(this.heat[p], infl * 0.7);
      this.writeVoxel(p);
    });
  }

  /** Push pending changes to the GPU. Call once per frame. */
  upload() {
    if (this.strokesDirty && this.session) {
      this.rebuild();
      this.strokesDirty = false;
    }
    // Only the z-layers that changed go to the GPU (a few hundred KB
    // instead of the whole 4 MB volume), unless the texture is new.
    if (this.sdfDirty) {
      if (!this.uploadLayers?.(this.sdfTex, this.sdfHalf, this.sdfK[0], this.sdfK[1], 1)) this.sdfTex.needsUpdate = true;
      this.sdfDirty = false;
      this.sdfK = [Infinity, -Infinity];
    }
    if (this.attrDirty) {
      if (!this.uploadLayers?.(this.attrTex, this.attr8, this.attrK[0], this.attrK[1], 2)) this.attrTex.needsUpdate = true;
      this.attrDirty = false;
      this.attrK = [Infinity, -Infinity];
    }
  }
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
