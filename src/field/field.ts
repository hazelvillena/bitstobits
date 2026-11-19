import {
  Mesh,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { codeOf, type Specimen } from '../specimen/specimen';
import { kinship, sharedTraits } from '../specimen/signature';
import { createSpecimenMaterial } from './specimenMaterial';
import { specimenGeometry } from './geometry';
import { Bridge, BRIDGE } from './bridge';
import { traitHex, type TraitKey } from '../ui/tokens';

const THRESHOLD = 0.62;
const MAX_KIN = 2;

interface Item {
  spec: Specimen;
  mesh: Mesh;
  mat: ReturnType<typeof createSpecimenMaterial>;
  pos: Vector3;
  vel: Vector3;
  spin: number;
  born: number;
  radius: number;
  sample: number[]; // vertex indices used for support queries
  label: HTMLDivElement;
  focus: number;
}

interface Link {
  a: Item;
  b: Item;
  k: number;
  traits: { trait: TraitKey; score: number }[];
  born: number;
  bridge: Bridge;
  /**
   * Anchors in each form's own (mesh) space: eased so they glide over the
   * surface, and carried by the form so the bridge never detaches from it.
   */
  anchor: { pa: Vector3; na: Vector3; pb: Vector3; nb: Vector3 } | null;
  phase: number;
  }

/** The collection: forms arrange by kinship and attach where they agree. */
export class Field {
  readonly renderer: WebGLRenderer;
  readonly camera = new PerspectiveCamera(24, 1, 0.1, 100);
  readonly scene = new Scene();
  items: Item[] = [];
  links: Link[] = [];
  onHover: (spec: Specimen | null, kin: { spec: Specimen; k: number; trait: TraitKey }[]) => void = () => {};

  private time = 0;
  private half = { w: 4, h: 4 };
  private hovered: Item | null = null;
  private mouse: { x: number; y: number } | null = null;

  constructor(private canvas: HTMLCanvasElement, private labels: HTMLElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.camera.position.set(0, 0, 16);
    this.resize();
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
    });
    canvas.addEventListener('pointerleave', () => (this.mouse = null));
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // Pull back in narrow panes so the field always has room to breathe.
    const tanHalf = Math.tan((this.camera.fov * Math.PI) / 360);
    this.camera.position.z = Math.max(16, 2.3 / (tanHalf * (w / h)));
    const hh = tanHalf * this.camera.position.z;
    this.half = { w: hh * (w / h), h: hh };
  }

  add(spec: Specimen, fromSeam = true) {
    const { geo, radius: r0 } = specimenGeometry(spec);
    const mat = createSpecimenMaterial(spec.material);
    const mesh = new Mesh(geo, mat);
    const radius = 0.42 * (0.85 + spec.sig.volume * 0.3);
    mesh.scale.setScalar(radius / r0);
    mesh.rotation.set(Math.random() * 0.6, Math.random() * Math.PI * 2, 0);
    this.scene.add(mesh);

    const nv = spec.mesh.positions.length / 3;
    const step = Math.max(1, Math.floor(nv / 700));
    const sample: number[] = [];
    for (let i = 0; i < nv; i += step) sample.push(i);

    const label = document.createElement('div');
    label.className = 'tag specimen';
    label.textContent = codeOf(spec);
    this.labels.appendChild(label);

    const pos = fromSeam
      ? new Vector3(-this.half.w - 1, (Math.random() - 0.5) * this.half.h, 0)
      : new Vector3((Math.random() - 0.5) * this.half.w * 1.4, (Math.random() - 0.5) * this.half.h * 1.4, (Math.random() - 0.5) * 0.6);
    const item: Item = {
      spec, mesh, mat, pos,
      vel: fromSeam ? new Vector3(3.2, 0, 0) : new Vector3(),
      spin: (Math.random() - 0.5) * 0.25,
      born: this.time,
      radius,
      sample,
      label,
      focus: 1,
    };
    this.items.push(item);
    this.relink();
  }

  clear() {
    for (const it of this.items) {
      this.scene.remove(it.mesh);
      it.mesh.geometry.dispose();
      it.mat.dispose();
      it.label.remove();
    }
    this.items = [];
    this.relink();
  }

  /** Recompute attachments: each form links to its closest kin above threshold. */
  private relink() {
    const old = new Map(this.links.map((l) => [this.key(l.a, l.b), l]));
    const pop = this.items.map((i) => i.spec.sig);
    const wanted = new Map<string, { a: Item; b: Item; k: number }>();
    for (const a of this.items) {
      const ranked = this.items
        .filter((b) => b !== a)
        .map((b) => ({ b, k: kinship(a.spec.sig, b.spec.sig) }))
        .filter((x) => x.k >= THRESHOLD)
        .sort((x, y) => y.k - x.k)
        .slice(0, MAX_KIN);
      for (const { b, k } of ranked) wanted.set(this.key(a, b), { a, b, k });
    }
    const next: Link[] = [];
    for (const [key, w] of wanted) {
      const prev = old.get(key);
      if (prev) {
        next.push(prev);
        old.delete(key);
        continue;
      }
      const traits = sharedTraits(w.a.spec.sig, w.b.spec.sig, pop);
      const bridge = new Bridge(w.a.spec.material ?? 'pearl', w.b.spec.material ?? 'pearl', traitHex[traits[0]?.trait ?? 'volume']);
      this.scene.add(bridge.mesh);
      // The reason for a link is shown in the hover card, not on the canvas.
      next.push({ a: w.a, b: w.b, k: w.k, traits, born: this.time, bridge, anchor: null, phase: Math.random() * Math.PI * 2 });
    }
    for (const l of old.values()) this.disposeLink(l);
    this.links = next;
  }

  private disposeLink(l: Link) {
    this.scene.remove(l.bridge.mesh);
    l.bridge.dispose();
  }

  private key(a: Item, b: Item) {
    return a.spec.id < b.spec.id ? `${a.spec.id}|${b.spec.id}` : `${b.spec.id}|${a.spec.id}`;
  }

  /** Surface point of `it` furthest along world direction `dir`, and its normal, in the form's mesh space. */
  private support(it: Item, dir: Vector3, out: Vector3, nOut: Vector3) {
    const inv = it.mesh.quaternion.clone().invert();
    const ld = dir.clone().applyQuaternion(inv);
    const P = it.mesh.geometry.getAttribute('position').array as Float32Array;
    const N = it.spec.mesh.normals;
    // Weighted average of the points facing furthest along dir: continuous,
    // so the anchor slides over the surface instead of jumping.
    let best = -Infinity;
    for (const i of it.sample) best = Math.max(best, P[i * 3] * ld.x + P[i * 3 + 1] * ld.y + P[i * 3 + 2] * ld.z);
    const band = 0.04 / it.mesh.scale.x;
    let w = 0;
    out.set(0, 0, 0);
    nOut.set(0, 0, 0);
    for (const i of it.sample) {
      const d = P[i * 3] * ld.x + P[i * 3 + 1] * ld.y + P[i * 3 + 2] * ld.z;
      if (d < best - band) continue;
      const wi = 1 - (best - d) / band;
      out.x += P[i * 3] * wi; out.y += P[i * 3 + 1] * wi; out.z += P[i * 3 + 2] * wi;
      nOut.x += N[i * 3] * wi; nOut.y += N[i * 3 + 1] * wi; nOut.z += N[i * 3 + 2] * wi;
      w += wi;
    }
    out.divideScalar(w || 1);
    nOut.normalize();
  }

  update(dt: number) {
    this.time += dt;
    const its = this.items;
    const { w: hw, h: hh } = this.half;

    // Forces.
    const f = new Vector3();
    for (const a of its) {
      f.set(-a.pos.x * 0.12, -a.pos.y * 0.12, -a.pos.z * 0.8);
      for (const b of its) {
        if (a === b) continue;
        const d = a.pos.clone().sub(b.pos);
        const l = Math.max(d.length(), 0.3);
        const kin = this.isKin(a, b);
        const minD = a.radius + b.radius + (kin ? 0.22 : 0.5);
        if (l < minD * 2.2) f.addScaledVector(d.normalize(), (1.4 * (minD * 2.2 - l)) / l);
        if (l < minD) f.addScaledVector(d.normalize(), (minD - l) * 14);
      }
      // Soft walls inside the visible frame.
      const mx = hw - a.radius - 0.4, my = hh - a.radius - 0.7;
      if (a.pos.x > mx) f.x -= (a.pos.x - mx) * 6;
      if (a.pos.x < -mx && this.time - a.born > 1.2) f.x -= (a.pos.x + mx) * 6;
      if (a.pos.y > my) f.y -= (a.pos.y - my) * 6;
      if (a.pos.y < -my) f.y -= (a.pos.y + my) * 6;
      a.vel.addScaledVector(f, dt);
    }
    for (const l of this.links) {
      const d = l.b.pos.clone().sub(l.a.pos);
      const len = d.length() || 1;
      const rest = l.a.radius + l.b.radius + 0.12 + (1 - l.k) * 0.55;
      const pull = (len - rest) * 1.6 * l.k;
      d.multiplyScalar(pull / len);
      l.a.vel.addScaledVector(d, dt);
      l.b.vel.addScaledVector(d, -dt);
    }
    for (const a of its) {
      // The form in focus holds still while you look at it.
      a.vel.multiplyScalar(Math.exp(-dt * (a === this.hovered ? 12 : 1.8)));
      a.pos.addScaledVector(a.vel, dt);
      a.mesh.position.copy(a.pos);
      if (a !== this.hovered) a.mesh.rotateY(a.spin * dt);
      const age = Math.min(1, (this.time - a.born) / 1.4);
      const e = 1 - Math.pow(1 - age, 3);
      a.mat.uniforms.uOpacity.value = e;
    }

    this.updateHover(dt);

    // Bridges.
    const pa = new Vector3(), pb = new Vector3(), na = new Vector3(), nb = new Vector3();
    const side = new Vector3();
    const ease = 1 - Math.exp(-dt * 3);
    for (const l of this.links) {
      const dir = l.b.pos.clone().sub(l.a.pos).normalize();
      // Find where each form faces the other, in its own space, and ease there.
      this.support(l.a, dir, pa, na);
      this.support(l.b, dir.clone().negate(), pb, nb);
      if (!l.anchor) l.anchor = { pa: pa.clone(), na: na.clone(), pb: pb.clone(), nb: nb.clone() };
      const A = l.anchor;
      A.pa.lerp(pa, ease); A.pb.lerp(pb, ease);
      A.na.lerp(na, ease).normalize(); A.nb.lerp(nb, ease).normalize();
      // Carry the anchors with their forms into world space.
      pa.copy(A.pa); l.a.mesh.localToWorld(pa);
      pb.copy(A.pb); l.b.mesh.localToWorld(pb);
      na.copy(A.na).applyQuaternion(l.a.mesh.quaternion);
      nb.copy(A.nb).applyQuaternion(l.b.mesh.quaternion);
      // Align both ends with the line between the forms: a calm, straight span.
      na.lerp(dir, 0.85).normalize();
      nb.lerp(dir.clone().negate(), 0.85).normalize();

      side.crossVectors(dir, new Vector3(0, 0, 1)).normalize();
      const grow = Math.min(1, (this.time - l.born - 0.6) / 2.4);
      const g = grow <= 0 ? 0 : 1 - Math.pow(1 - grow, 3);
      const focus = this.hovered ? (l.a === this.hovered || l.b === this.hovered ? 1 : 0.35) : 1;
      const strength = Math.min(1, Math.max(0, (l.k - 0.6) / 0.4));
      const filament = Math.min(l.a.radius, l.b.radius) * (BRIDGE.filament[0] + (BRIDGE.filament[1] - BRIDGE.filament[0]) * strength);
      const sway = Math.sin(this.time * 0.35 + l.phase);
      l.bridge.update(pa, na, pb, nb, l.a.radius * BRIDGE.root, l.b.radius * BRIDGE.root, filament, side, sway, g, focus);
    }

    // Names beneath forms.
    for (const it of its) {
      const p = this.project(it.pos.clone().add(new Vector3(0, -it.radius - 0.06, 0)));
      it.label.style.transform = `translate(${p.x}px, ${p.y}px) translateX(-50%)`;
      const age = Math.min(1, (this.time - it.born) / 1.4);
      const dimmed = this.hovered && this.hovered !== it && !this.isKin(this.hovered, it);
      it.label.style.opacity = String(age * (dimmed ? 0.25 : this.hovered === it ? 1 : 0.7));
    }
  }

  private isKin(a: Item, b: Item) {
    return this.links.some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
  }

  private updateHover(dt: number) {
    // Sticky hover: the current form keeps focus until the pointer is
    // clearly away from it, so drifting edges never flicker the card.
    let best: Item | null = null;
    if (this.mouse) {
      const dist = (it: Item) => {
        const p = this.project(it.pos);
        return Math.hypot(p.x - this.mouse!.x, p.y - this.mouse!.y);
      };
      const cur = this.hovered && this.items.includes(this.hovered) ? this.hovered : null;
      if (cur && dist(cur) < this.pixelRadius(cur) + 36) best = cur;
      else {
        let bd = Infinity;
        for (const it of this.items) {
          const d = dist(it);
          if (d < this.pixelRadius(it) + 10 && d < bd) {
            bd = d;
            best = it;
          }
        }
      }
    }
    if (best !== this.hovered) {
      this.hovered = best;
      if (best) {
        const kin = this.links
          .filter((l) => l.a === best || l.b === best)
          .map((l) => ({ spec: (l.a === best ? l.b : l.a).spec, k: l.k, trait: l.traits[0]?.trait ?? 'volume' }))
          .sort((x, y) => y.k - x.k);
        this.onHover(best.spec, kin);
      } else this.onHover(null, []);
    }
    for (const it of this.items) {
      const target = !this.hovered || it === this.hovered || this.isKin(this.hovered, it) ? 1 : 0.35;
      it.focus += (target - it.focus) * Math.min(1, dt * 6);
      it.mat.uniforms.uFocus.value = it.focus;
    }
  }

  /** Screen position and radius of the hovered form, for anchoring its card. */
  hoverAnchor(): { x: number; y: number; r: number } | null {
    if (!this.hovered) return null;
    const p = this.project(this.hovered.pos);
    return { x: p.x, y: p.y, r: this.pixelRadius(this.hovered) };
  }

  private pixelRadius(it: Item) {
    const a = this.project(it.pos), b = this.project(it.pos.clone().add(new Vector3(it.radius, 0, 0)));
    return Math.abs(b.x - a.x);
  }

  project(v: Vector3) {
    const p = v.clone().project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * this.canvas.clientWidth, y: (-p.y * 0.5 + 0.5) * this.canvas.clientHeight };
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  get count() {
    return this.items.length;
  }
}
