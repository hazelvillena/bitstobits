import { Vector3 } from 'three';
import type { Atelier } from '../render/atelier';

export type ToolKind = 'drill' | 'pull' | 'press' | 'smooth' | 'turn';

export const TOOLS: { kind: ToolKind; name: string; hand: string; key: string }[] = [
  { kind: 'drill', name: 'Pierce', hand: 'touch', key: '1' },
  { kind: 'pull', name: 'Pull', hand: 'pinch and drag', key: '2' },
  { kind: 'press', name: 'Press', hand: 'touch', key: '3' },
  { kind: 'smooth', name: 'Smooth', hand: 'touch', key: '4' },
  { kind: 'turn', name: 'Rotate', hand: 'pinch and drag', key: '5' },
];

/**
 * Applies tools to the volume. All inputs are world-space; the sculptor
 * converts into the object's local frame (the object may be rotating).
 */
export class Sculptor {
  private a = new Vector3();
  private b = new Vector3();
  private dir = new Vector3();
  private pullPrev = new Map<string, Vector3>();
  constructor(private atelier: Atelier) {}

  private get vol() {
    return this.atelier.volume;
  }
  private local(world: Vector3, out: Vector3) {
    return this.atelier.toLocal(world, out);
  }
  distanceAt(world: Vector3) {
    const p = this.local(world, new Vector3());
    return this.vol.sample(p.x, p.y, p.z);
  }

  /** Fingertip piercing along its direction of travel / pointing. */
  drill(tipWorld: Vector3, dirWorld: Vector3, dt: number, radius = 0.075) {
    const tip = this.local(tipWorld, this.a);
    const d = this.vol.sample(tip.x, tip.y, tip.z);
    if (d > 0.03) return false;
    this.atelier.toLocalDir(dirWorld, this.dir).normalize();
    const depth = Math.min(0.06, 0.9 * dt + 0.02);
    const from = this.b.copy(tip).addScaledVector(this.dir, -0.05);
    const to = tip.clone().addScaledVector(this.dir, depth);
    this.vol.capsule(from, to, radius, radius * 0.92, 0.05, -1, 0.35 * dt * 6);
    this.atelier.touch();
    return true;
  }

  /**
   * Pull: pinch the surface and drag it like clay. The grabbed point follows
   * the hand with a little weight; matter around it comes along and thins
   * into a neck, so long pulls become tendrils that stay attached.
   */
  pull(id: string, pointWorld: Vector3, active: boolean) {
    const p = this.local(pointWorld, new Vector3());
    const anchor = this.pullPrev.get(id);
    if (!active) {
      if (anchor) this.pullPrev.delete(id);
      return false;
    }
    if (!anchor) {
      // One grab at a time; start only on (or just above) the surface.
      if (this.pullPrev.size > 0) return false;
      if (this.vol.sample(p.x, p.y, p.z) > 0.08) return false;
      this.pullPrev.set(id, p.clone());
      return true;
    }
    const target = anchor.clone().lerp(p, 0.3);
    const move = target.sub(anchor);
    const len = move.length();
    if (len < 1e-4) return true;
    const R = this.grabRadius;
    const steps = Math.min(8, Math.ceil(len / (R * 0.3)));
    move.divideScalar(steps);
    for (let i = 0; i < steps; i++) {
      this.vol.grabStep(anchor, move, R);
      anchor.add(move);
    }
    this.atelier.touch();
    return true;
  }
  grabRadius = 0.2;

  press(centerWorld: Vector3, normalWorld: Vector3, dt: number, radius = 0.24) {
    const c = this.local(centerWorld, this.a);
    const d = this.vol.sample(c.x, c.y, c.z);
    if (d > 0.04) return false;
    this.atelier.toLocalDir(normalWorld, this.dir).normalize();
    // Push a soft sphere centred just outside the contact point.
    const at = this.b.copy(c).addScaledVector(this.dir, -radius * 0.82 + Math.min(0.05, dt * 0.6));
    this.vol.sphere(at, radius, 0.14, -1, 0.5 * dt * 4);
    this.atelier.touch();
    return true;
  }

  smooth(centerWorld: Vector3, dt: number, radius = 0.26) {
    const c = this.local(centerWorld, this.a);
    if (this.vol.sample(c.x, c.y, c.z) > radius) return false;
    this.vol.smooth(c, radius, Math.min(1, dt * 12));
    this.atelier.touch();
    return true;
  }
}
