import { Quaternion, Vector3 } from 'three';
import { Volume } from './volume';
import type { Atelier } from '../render/atelier';

export type ToolKind = 'extrude' | 'spike' | 'drill' | 'smooth' | 'turn';

export const TOOLS: { kind: ToolKind; name: string; hand: string; key: string }[] = [
  { kind: 'extrude', name: 'Extrude', hand: 'pinch and pull', key: '1' },
  { kind: 'spike', name: 'Spike', hand: 'pinch and pull', key: '2' },
  { kind: 'drill', name: 'Pierce', hand: 'pinch and hold', key: '3' },
  { kind: 'smooth', name: 'Smooth', hand: 'pinch and move', key: '4' },
  { kind: 'turn', name: 'Rotate', hand: 'pinch and drag', key: '5' },
];

interface ExtrudeStroke {
  P: Vector3; // grabbed surface point (local)
  N: Vector3; // surface normal at P (local)
  wpp: number; // world units per screen pixel at the grab depth
  amount: number; // eased length along N
  profile: Profile;
  vid: number; // stroke id in the volume
}

/**
 * Applies tools to the volume. Inputs are world space; the sculptor converts
 * into the object's local frame. Every tool is rate-limited and eases in, so
 * nothing jumps: small, deliberate changes.
 */
export class Sculptor {
  /** Brush radius in object units, adjustable with [ and ]. */
  brush = 0.12;
  private a = new Vector3();
  private b = new Vector3();
  private dir = new Vector3();
  private strokes = new Map<string, ExtrudeStroke>();
  constructor(private atelier: Atelier) {}

  private get vol() {
    return this.atelier.volume;
  }
  private local(world: Vector3, out: Vector3) {
    return this.atelier.toLocal(world, out);
  }

  setBrush(r: number) {
    this.brush = Math.min(0.28, Math.max(0.05, r));
  }

  /** Pierce: a slow, narrow bore along the view direction. */
  drill(tipWorld: Vector3, dirWorld: Vector3, dt: number, strength = 1) {
    const tip = this.local(tipWorld, this.a);
    if (this.vol.sample(tip.x, tip.y, tip.z) > 0.03) return false;
    this.atelier.toLocalDir(dirWorld, this.dir).normalize();
    const r = this.brush * 0.6;
    const depth = 0.22 * dt * strength;
    const from = this.b.copy(tip).addScaledVector(this.dir, -0.03);
    const to = tip.clone().addScaledVector(this.dir, depth);
    this.vol.capsule(from, to, r, r * 0.95, 0.035, -1, 0.6 * dt * strength);
    this.atelier.touch();
    return true;
  }

  /** Smooth: relaxes the surface gently under the brush. */
  smooth(centerWorld: Vector3, dt: number, strength = 1) {
    const c = this.local(centerWorld, this.a);
    const r = this.brush * 1.8;
    if (this.vol.sample(c.x, c.y, c.z) > r) return false;
    this.vol.smooth(c, r, Math.min(1, dt * 5 * strength));
    this.atelier.touch();
    return true;
  }

  // ───────────── Extrude ─────────────

  /**
   * Grab a round face of the surface. The extrusion always grows straight out
   * of the face, along its normal; as you pull, the whole form turns so that
   * face points along your pull, so the shape follows your hand naturally.
   * The form stays where it turned when you let go.
   */
  beginExtrude(id: string, hit: { point: Vector3; dist: number }, profile: Profile = ROUNDED) {
    const P = this.local(hit.point, new Vector3());
    if (this.vol.sample(P.x, P.y, P.z) > 0.05) return false;
    const N = this.vol.gradient(P, new Vector3());
    const s0 = this.atelier.project(hit.point);
    const p0 = this.atelier.pointOnRay(s0.x, s0.y, hit.dist, new Vector3());
    const p1 = this.atelier.pointOnRay(s0.x + 1, s0.y, hit.dist, new Vector3());
    const wpp = p0.distanceTo(p1) / this.atelier.object.scale.x;
    const vid = this.vol.beginStroke();
    this.strokes.set(id, { P, N, wpp, amount: 0, profile, vid });
    return true;
  }

  /** Drag in screen pixels since the grab started; dt in seconds. */
  dragExtrude(id: string, dx: number, dy: number, dt: number) {
    const st = this.strokes.get(id);
    if (!st) return false;
    const len = Math.hypot(dx, dy);

    // Turn the form so the grabbed face points along the pull (eased, ~0.5 s).
    // With two hands extruding, each keeps the form still for the other.
    if (len > 6 && this.strokes.size === 1) {
      const cam = this.atelier.camera;
      const pull = new Vector3(1, 0, 0).applyQuaternion(cam.quaternion).multiplyScalar(dx / len)
        .addScaledVector(new Vector3(0, 1, 0).applyQuaternion(cam.quaternion), -dy / len);
      const obj = this.atelier.object;
      const nWorld = st.N.clone().applyQuaternion(obj.quaternion);
      const full = new Quaternion().setFromUnitVectors(nWorld, pull.normalize());
      const step = new Quaternion().slerp(full, 1 - Math.exp(-dt * 6));
      obj.quaternion.premultiply(step);
    }

    // Length follows the pull, with a little weight; never past the volume.
    const target = Math.min(this.reach(st), len * st.wpp * 0.6);
    st.amount += (target - st.amount) * 0.22;
    this.applyExtrude(st);
    this.atelier.touch();
    return true;
  }

  /** How far a stroke can grow along N before leaving the sculpting volume. */
  private reach(st: ExtrudeStroke) {
    const L = Volume.LIMIT - this.brush * (st.profile.tip + 0.15) - 0.02;
    let t = Infinity;
    for (const a of ['x', 'y', 'z'] as const) {
      const n = st.N[a];
      if (Math.abs(n) < 1e-4) continue;
      t = Math.min(t, ((n > 0 ? L : -L) - st.P[a]) / n);
    }
    return Math.max(0, t);
  }

  endExtrude(id: string) {
    const st = this.strokes.get(id);
    if (!st) return;
    this.strokes.delete(id);
    this.vol.endStroke(st.vid);
  }

  private applyExtrude(st: ExtrudeStroke) {
    const r = this.brush;
    const { P, N, amount, profile } = st;
    // Root below the surface so the shape grows out of the body; the tip
    // stays hidden until the pull passes a small dead zone.
    const start = P.clone().addScaledVector(N, -r * 0.9);
    const end = P.clone().addScaledVector(N, amount - r * (0.3 + profile.tip * 0.5));
    const path: Vector3[] = [];
    for (let i = 0; i <= 12; i++) path.push(start.clone().lerp(end, i / 12));
    this.vol.setStroke(st.vid, { path, radii: taper(path.length, r, profile), sign: 1, blend: r * profile.blend });
  }
}

/**
 * Stroke profiles, as fractions of the brush radius. A profile tapers from
 * the root (full brush) to a fine tip; `power` shapes the taper (above 1
 * thins quickly, like a needle), `blend` is the fillet into the body.
 */
export interface Profile {
  tip: number;
  power: number;
  blend: number;
}
/** Default: a clean, rounded taper ending in a soft round tip. */
export const ROUNDED: Profile = { tip: 0.5, power: 0.85, blend: 0.65 };
/** A sharp, thin needle: an almost straight cone to a fine point. */
export const SPIKE: Profile = { tip: 0.02, power: 1.05, blend: 0.45 };

function taper(n: number, r: number, p: Profile) {
  const radii: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    radii.push(r * (p.tip + (1 - p.tip) * Math.pow(1 - t, p.power)));
  }
  return radii;
}

