import { Vector3 } from 'three';
import type { Atelier } from '../render/atelier';

export type ToolKind = 'drill' | 'pull' | 'press' | 'smooth' | 'turn';

export const TOOLS: { kind: ToolKind; name: string; hand: string; key: string }[] = [
  { kind: 'drill', name: 'Pierce', hand: 'Point', key: '1' },
  { kind: 'pull', name: 'Draw out', hand: 'Pinch', key: '2' },
  { kind: 'press', name: 'Press', hand: 'Open palm', key: '3' },
  { kind: 'smooth', name: 'Smooth', hand: 'Two fingers', key: '4' },
  { kind: 'turn', name: 'Turn', hand: 'Fist', key: '5' },
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
    this.vol.capsule(from, to, radius, radius * 0.92, 0.025, -1, 0.35 * dt * 6);
    this.atelier.touch();
    return true;
  }

  /** Begin/continue drawing matter out. Returns true while anchored. */
  pull(id: string, pointWorld: Vector3, active: boolean) {
    const p = this.local(pointWorld, new Vector3());
    const prev = this.pullPrev.get(id);
    if (!active) {
      this.pullPrev.delete(id);
      return false;
    }
    if (!prev) {
      // Anchor only when starting on (or just above) the surface.
      if (this.vol.sample(p.x, p.y, p.z) > 0.1) return false;
      this.pullPrev.set(id, p.clone());
      return true;
    }
    // Catch up with fast motion in short segments.
    for (let i = 0; i < 10; i++) {
      const dist = prev.distanceTo(p);
      if (dist < 0.012) break;
      const end = prev.clone().lerp(p, Math.min(dist, 0.07) / dist);
      // Thinner as it travels outward from the body.
      const outward = Math.max(0, this.vol.sample(end.x, end.y, end.z));
      const r = Math.max(0.045, 0.1 - outward * 0.25);
      this.vol.capsule(prev, end, r * 1.05, r, 0.07, 1, -0.06);
      prev.copy(end);
    }
    this.atelier.touch();
    return true;
  }

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
