import { Quaternion, Vector3 } from 'three';
import { Volume } from './volume';
import { POCKET, ROUNDED, SPIKE, taper, type Profile } from './profiles';
import type { Atelier } from '../render/atelier';

export { ROUNDED, SPIKE, POCKET, type Profile } from './profiles';

export type ToolKind = 'extrude' | 'spike' | 'press' | 'drill' | 'turn';
export type StrokeKind = 'extrude' | 'spike' | 'press';

export const TOOLS: { kind: ToolKind; name: string; hand: string; key: string }[] = [
  { kind: 'extrude', name: 'Extrude', hand: 'pinch and pull', key: '1' },
  { kind: 'spike', name: 'Spike', hand: 'pinch and pull', key: '2' },
  { kind: 'press', name: 'Press', hand: 'pinch and pull', key: '3' },
  { kind: 'drill', name: 'Pierce', hand: 'pinch and hold', key: '4' },
  { kind: 'turn', name: 'Rotate', hand: 'pinch and drag', key: '5' },
];

/** Tools that grab a face and shape it with a stroke. */
export const isStroke = (k: ToolKind): k is StrokeKind => k === 'extrude' || k === 'spike' || k === 'press';

const PROFILE: Record<StrokeKind, Profile> = { extrude: ROUNDED, spike: SPIKE, press: POCKET };

interface Stroke {
  kind: StrokeKind;
  P: Vector3; // grabbed surface point (local)
  N: Vector3; // surface normal at P (local)
  wpp: number; // world units per screen pixel at the grab depth
  amount: number; // eased length (out for extrude/spike, in for press)
  vid: number; // stroke id in the volume
  end: Vector3; // current end of the stroke (local), for the face marker
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
  private strokes = new Map<string, Stroke>();
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

  // ───────────── Strokes: Extrude, Spike, Press ─────────────

  /**
   * Grab a round face of the surface.
   * - Extrude and Spike grow straight out of the face; as you pull, the form
   *   turns so that face points along the pull, and stays turned.
   * - Press sinks the face into a soft, flat pocket; the form holds still.
   */
  beginStroke(id: string, hit: { point: Vector3; dist: number }, kind: StrokeKind) {
    const P = this.local(hit.point, new Vector3());
    if (this.vol.sample(P.x, P.y, P.z) > 0.05) return false;
    const N = this.vol.gradient(P, new Vector3());
    const s0 = this.atelier.project(hit.point);
    const p0 = this.atelier.pointOnRay(s0.x, s0.y, hit.dist, new Vector3());
    const p1 = this.atelier.pointOnRay(s0.x + 1, s0.y, hit.dist, new Vector3());
    const wpp = p0.distanceTo(p1) / this.atelier.object.scale.x;
    const vid = this.vol.beginStroke();
    this.strokes.set(id, { kind, P, N, wpp, amount: 0, vid, end: P.clone() });
    return true;
  }

  /** Drag in screen pixels since the grab started; dt in seconds. */
  dragStroke(id: string, dx: number, dy: number, dt: number) {
    const st = this.strokes.get(id);
    if (!st) return false;
    const len = Math.hypot(dx, dy);

    // Turn the form so the grabbed face points along the pull (eased, ~0.5 s).
    // With two hands at work, each keeps the form still for the other.
    if (st.kind !== 'press' && len > 6 && this.strokes.size === 1) {
      const cam = this.atelier.camera;
      const pull = new Vector3(1, 0, 0).applyQuaternion(cam.quaternion).multiplyScalar(dx / len)
        .addScaledVector(new Vector3(0, 1, 0).applyQuaternion(cam.quaternion), -dy / len);
      const obj = this.atelier.object;
      const nWorld = st.N.clone().applyQuaternion(obj.quaternion);
      const full = new Quaternion().setFromUnitVectors(nWorld, pull.normalize());
      obj.quaternion.premultiply(new Quaternion().slerp(full, 1 - Math.exp(-dt * 6)));
    }

    // Length follows the pull with a little weight; never past the volume,
    // and a press never sinks deeper than the form can take.
    const max = st.kind === 'press' ? Math.min(0.32, this.depthInside(st) * 0.7) : this.reach(st);
    const target = Math.min(max, len * st.wpp * (st.kind === 'press' ? 0.4 : 0.6));
    st.amount += (target - st.amount) * 0.22;
    this.apply(st);
    this.atelier.touch();
    return true;
  }

  /** World position of the face being shaped: the tip of an extrusion, the floor of a press. */
  strokeMarker(id: string): Vector3 | null {
    const st = this.strokes.get(id);
    if (!st) return null;
    return this.atelier.object.localToWorld(st.end.clone());
  }

  endStroke(id: string) {
    const st = this.strokes.get(id);
    if (!st) return;
    this.strokes.delete(id);
    this.vol.endStroke(st.vid);
  }

  /** How far a stroke can grow along N before leaving the sculpting volume. */
  private reach(st: Stroke) {
    const L = Volume.LIMIT - this.brush * (PROFILE[st.kind].tip + 0.15) - 0.02;
    let t = Infinity;
    for (const a of ['x', 'y', 'z'] as const) {
      const n = st.N[a];
      if (Math.abs(n) < 1e-4) continue;
      t = Math.min(t, ((n > 0 ? L : -L) - st.P[a]) / n);
    }
    return Math.max(0, t);
  }

  /** How much matter lies behind the face, along -N. */
  private depthInside(st: Stroke) {
    let t = 0;
    const p = new Vector3();
    while (t < 1.2) {
      p.copy(st.P).addScaledVector(st.N, -(t + 0.02));
      if (this.vol.sample(p.x, p.y, p.z) > 0) break;
      t += 0.02;
    }
    return t;
  }

  private apply(st: Stroke) {
    const r = this.brush;
    const prof = PROFILE[st.kind];
    const { P, N, amount } = st;
    let start: Vector3, end: Vector3;
    if (st.kind === 'press') {
      // A rounded pocket: from just above the face down to its floor.
      start = P.clone().addScaledVector(N, r * 0.5);
      end = P.clone().addScaledVector(N, -amount + r * 0.15);
      st.end.copy(P).addScaledVector(N, -amount);
    } else {
      // Root below the surface so the shape grows out of the body; the tip
      // stays hidden until the pull passes a small dead zone.
      start = P.clone().addScaledVector(N, -r * 0.9);
      end = P.clone().addScaledVector(N, amount - r * (0.3 + prof.tip * 0.5));
      st.end.copy(P).addScaledVector(N, Math.max(0, amount - r * 0.3));
    }
    const path: Vector3[] = [];
    for (let i = 0; i <= 12; i++) path.push(start.clone().lerp(end, i / 12));
    this.vol.setStroke(st.vid, {
      path,
      radii: taper(path.length, r, prof),
      sign: st.kind === 'press' ? -1 : 1,
      blend: r * prof.blend,
    });
  }
}
