import { Vector3 } from 'three';
import type { Atelier } from '../render/atelier';

export type ToolKind = 'drill' | 'extrude' | 'smooth' | 'turn';

export const TOOLS: { kind: ToolKind; name: string; hand: string; key: string }[] = [
  { kind: 'extrude', name: 'Spike', hand: 'pinch and drag', key: '1' },
  { kind: 'drill', name: 'Pierce', hand: 'pinch and hold', key: '2' },
  { kind: 'smooth', name: 'Smooth', hand: 'pinch and move', key: '3' },
  { kind: 'turn', name: 'Rotate', hand: 'pinch and drag', key: '4' },
];

interface ExtrudeStroke {
  P: Vector3; // grabbed surface point (local)
  N: Vector3; // surface normal at P (local)
  sx: number; // screen direction that means "outward"
  sy: number;
  wpp: number; // world units per screen pixel at the grab depth
  amount: number; // eased, signed distance along N
  lat: Vector3; // eased sideways bend (local)
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
   * Grab a round face of the surface. Dragging along the face's outward
   * direction (as seen on screen) extrudes it; dragging the other way insets
   * it; dragging sideways bends the extrusion, and its end face turns toward
   * the direction of travel.
   */
  beginExtrude(id: string, hit: { point: Vector3; dist: number }) {
    const P = this.local(hit.point, new Vector3());
    if (this.vol.sample(P.x, P.y, P.z) > 0.05) return false;
    const N = this.vol.gradient(P, new Vector3());

    // How the face's normal looks on screen, to read drags in its terms.
    const nWorld = N.clone().applyQuaternion(this.atelier.object.quaternion);
    const s0 = this.atelier.project(hit.point);
    const s1 = this.atelier.project(hit.point.clone().addScaledVector(nWorld, 0.1));
    const p0 = this.atelier.pointOnRay(s0.x, s0.y, hit.dist, new Vector3());
    const p1 = this.atelier.pointOnRay(s0.x + 1, s0.y, hit.dist, new Vector3());
    const wpp = p0.distanceTo(p1) / this.atelier.object.scale.x;
    let nx = ((s1.x - s0.x) * wpp) / 0.1, ny = ((s1.y - s0.y) * wpp) / 0.1;
    const facing = Math.min(1, Math.hypot(nx, ny));
    // A face pointing at the camera has no screen direction: use "up" for out.
    ny += -1 * (1 - facing);
    const l = Math.hypot(nx, ny) || 1;

    const vid = this.vol.beginStroke();
    this.strokes.set(id, { P, N, sx: nx / l, sy: ny / l, wpp, amount: 0, lat: new Vector3(), vid });
    return true;
  }

  /** Drag in screen pixels since the grab started. */
  dragExtrude(id: string, dx: number, dy: number) {
    const st = this.strokes.get(id);
    if (!st) return false;
    const along = dx * st.sx + dy * st.sy;
    const px = dx - st.sx * along, py = dy - st.sy * along;
    const target = Math.min(0.6, Math.max(-0.4, along * st.wpp * 0.55));
    // Sideways drag in world, then into the object's frame.
    const cam = this.atelier.camera;
    const right = new Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = new Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const latW = right.multiplyScalar(px).addScaledVector(up, -py).multiplyScalar(st.wpp * 0.4);
    const latL = this.atelier.toLocalDir(latW, new Vector3());
    latL.addScaledVector(st.N, -latL.dot(st.N)); // keep the bend tangent to the face

    // Ease: the clay follows the hand with a little weight.
    st.amount += (target - st.amount) * 0.22;
    st.lat.lerp(latL, 0.22);
    this.applyExtrude(st);
    this.atelier.touch();
    return true;
  }

  endExtrude(id: string) {
    const st = this.strokes.get(id);
    if (!st) return;
    this.strokes.delete(id);
    this.vol.endStroke(st.vid);
  }

  private applyExtrude(st: ExtrudeStroke) {
    const r = this.brush;
    const { P, N, amount, lat } = st;
    const out = amount >= 0;
    const prof = out ? SPIKE : PUNCTURE;
    // Root below the surface so the stroke grows out of (or into) the body.
    // The tip stays hidden until the drag passes a small dead zone.
    const start = P.clone().addScaledVector(N, out ? -r * 0.9 : r * 0.4);
    const reach = out ? amount - r * 0.3 : amount;
    const ctrl = P.clone().addScaledVector(N, reach * 0.55);
    const end = P.clone().addScaledVector(N, reach).addScaledVector(lat, out ? 1 : 0.5);
    const path = bezier(start, ctrl, end, 12);
    this.vol.setStroke(st.vid, {
      path,
      radii: taper(path.length, r, prof),
      sign: out ? 1 : -1,
      blend: r * prof.blend,
    });
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
export const SPIKE: Profile = { tip: 0.035, power: 1.35, blend: 0.6 };
export const PUNCTURE: Profile = { tip: 0.18, power: 1.0, blend: 0.22 };

function taper(n: number, r: number, p: Profile) {
  const radii: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    radii.push(r * (p.tip + (1 - p.tip) * Math.pow(1 - t, p.power)));
  }
  return radii;
}

function bezier(a: Vector3, c: Vector3, b: Vector3, n: number) {
  const pts: Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push(new Vector3().addScaledVector(a, u * u).addScaledVector(c, 2 * u * t).addScaledVector(b, t * t));
  }
  return pts;
}
