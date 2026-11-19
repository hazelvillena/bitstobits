import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Line,
  LineBasicMaterial,
  Mesh,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Specimen } from '../specimen/specimen';
import { kinship, sharedTraits } from '../specimen/signature';
import { createSpecimenMaterial } from './specimenMaterial';
import { traitHex, traitLabel, type TraitKey } from '../ui/tokens';

const THRESHOLD = 0.62;
const MAX_KIN = 3;
const STRANDS = 3;
const SEGS = 40;

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
  strands: Line[];
  label: HTMLDivElement;
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
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(spec.mesh.positions, 3));
    geo.setAttribute('normal', new BufferAttribute(spec.mesh.normals, 3));
    geo.setAttribute('aCurv', new BufferAttribute(spec.mesh.curvature, 1));
    geo.setAttribute('aComp', new BufferAttribute(spec.mesh.compression, 1));
    geo.setIndex(new BufferAttribute(spec.mesh.indices, 1));
    geo.computeBoundingSphere();
    const bs = geo.boundingSphere!;
    geo.translate(-bs.center.x, -bs.center.y, -bs.center.z);
    const mat = createSpecimenMaterial();
    const mesh = new Mesh(geo, mat);
    const radius = 0.5 * (0.85 + spec.sig.volume * 0.3);
    mesh.scale.setScalar(radius / bs.radius);
    mesh.rotation.set(Math.random() * 0.6, Math.random() * Math.PI * 2, 0);
    this.scene.add(mesh);

    const nv = spec.mesh.positions.length / 3;
    const step = Math.max(1, Math.floor(nv / 240));
    const sample: number[] = [];
    for (let i = 0; i < nv; i += step) sample.push(i);

    const label = document.createElement('div');
    label.className = 'tag specimen';
    label.textContent = spec.name;
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
      const color = new Color(traitHex[traits[0]?.trait ?? 'volume']);
      const strands: Line[] = [];
      for (let s = 0; s < STRANDS; s++) {
        const g = new BufferGeometry();
        g.setAttribute('position', new BufferAttribute(new Float32Array((SEGS + 1) * 3), 3));
        g.setDrawRange(0, 0);
        const line = new Line(g, new LineBasicMaterial({ color, transparent: true, opacity: s === 0 ? 0.85 : 0.35, depthWrite: false }));
        line.frustumCulled = false;
        this.scene.add(line);
        strands.push(line);
      }
      const label = document.createElement('div');
      label.className = 'tag link';
      label.style.opacity = '0';
      const t0 = traits[0];
      const fmt = (t: TraitKey, v: number) => (t === 'genus' ? String(Math.round(v * 4)) : v.toFixed(2).replace(/^0/, ''));
      label.innerHTML = t0
        ? `<i style="background:${traitHex[t0.trait]}"></i>${traitLabel[t0.trait]} ${fmt(t0.trait, w.a.spec.sig[t0.trait])} and ${fmt(t0.trait, w.b.spec.sig[t0.trait])}`
        : '';
      this.labels.appendChild(label);
      next.push({ a: w.a, b: w.b, k: w.k, traits, born: this.time, strands, label });
    }
    for (const l of old.values()) this.disposeLink(l);
    this.links = next;
  }

  private disposeLink(l: Link) {
    for (const s of l.strands) {
      this.scene.remove(s);
      s.geometry.dispose();
      (s.material as LineBasicMaterial).dispose();
    }
    l.label.remove();
  }

  private key(a: Item, b: Item) {
    return a.spec.id < b.spec.id ? `${a.spec.id}|${b.spec.id}` : `${b.spec.id}|${a.spec.id}`;
  }

  /** Surface point of `it` furthest along world direction `dir`, plus its normal. */
  private support(it: Item, dir: Vector3, out: Vector3, nOut: Vector3) {
    const inv = it.mesh.quaternion.clone().invert();
    const ld = dir.clone().applyQuaternion(inv);
    const P = it.mesh.geometry.getAttribute('position').array as Float32Array;
    const N = it.spec.mesh.normals;
    let best = -Infinity, bi = 0;
    for (const i of it.sample) {
      const d = P[i * 3] * ld.x + P[i * 3 + 1] * ld.y + P[i * 3 + 2] * ld.z;
      if (d > best) {
        best = d;
        bi = i;
      }
    }
    out.set(P[bi * 3], P[bi * 3 + 1], P[bi * 3 + 2]);
    it.mesh.localToWorld(out);
    nOut.set(N[bi * 3], N[bi * 3 + 1], N[bi * 3 + 2]).applyQuaternion(it.mesh.quaternion).normalize();
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
        const minD = a.radius + b.radius + 0.5;
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
      const rest = l.a.radius + l.b.radius + 0.6 + (1 - l.k) * 1.6;
      const pull = (len - rest) * 1.6 * l.k;
      d.multiplyScalar(pull / len);
      l.a.vel.addScaledVector(d, dt);
      l.b.vel.addScaledVector(d, -dt);
    }
    for (const a of its) {
      a.vel.multiplyScalar(Math.exp(-dt * 1.8));
      a.pos.addScaledVector(a.vel, dt);
      a.mesh.position.copy(a.pos);
      a.mesh.rotateY(a.spin * dt);
      const age = Math.min(1, (this.time - a.born) / 1.4);
      const e = 1 - Math.pow(1 - age, 3);
      a.mat.uniforms.uOpacity.value = e;
    }

    this.updateHover(dt);

    // Ligaments.
    const pa = new Vector3(), pb = new Vector3(), na = new Vector3(), nb = new Vector3();
    const c1 = new Vector3(), c2 = new Vector3(), tmp = new Vector3();
    const side = new Vector3();
    for (const l of this.links) {
      const dir = l.b.pos.clone().sub(l.a.pos).normalize();
      this.support(l.a, dir, pa, na);
      this.support(l.b, dir.clone().negate(), pb, nb);
      const span = pa.distanceTo(pb);
      side.crossVectors(dir, new Vector3(0, 0, 1)).normalize();
      const grow = Math.min(1, (this.time - l.born - 0.6) / 1.6);
      const g = grow <= 0 ? 0 : 1 - Math.pow(1 - grow, 3);
      const focus = this.hovered ? (l.a === this.hovered || l.b === this.hovered ? 1 : 0.18) : 0.75;
      l.strands.forEach((s, si) => {
        const off = (si - (STRANDS - 1) / 2) * 0.05;
        const tension = 0.16 + si * 0.05;
        const sag = Math.sin(this.time * 0.6 + si * 1.7) * 0.04;
        c1.copy(pa).addScaledVector(na, span * tension).addScaledVector(side, off * 2 + sag);
        c2.copy(pb).addScaledVector(nb, span * tension).addScaledVector(side, off * 2 - sag);
        const arr = s.geometry.getAttribute('position') as BufferAttribute;
        for (let i = 0; i <= SEGS; i++) {
          const t = i / SEGS, u = 1 - t;
          tmp.copy(pa).multiplyScalar(u * u * u)
            .addScaledVector(c1, 3 * u * u * t)
            .addScaledVector(c2, 3 * u * t * t)
            .addScaledVector(pb, t * t * t);
          tmp.addScaledVector(side, off * Math.sin(Math.PI * t));
          arr.setXYZ(i, tmp.x, tmp.y, tmp.z);
        }
        arr.needsUpdate = true;
        s.geometry.setDrawRange(0, Math.floor((SEGS + 1) * g));
        (s.material as LineBasicMaterial).opacity = (si === 0 ? 0.9 : 0.4) * focus;
      });
      // Label at the middle of the main strand, only for the form in focus.
      const show = this.hovered && (l.a === this.hovered || l.b === this.hovered) && g > 0.9;
      const mid = new Vector3().addVectors(pa, pb).multiplyScalar(0.5).addScaledVector(side, 0.12);
      const p = this.project(mid);
      l.label.style.transform = `translate(${p.x + 6}px, ${p.y - 8}px)`;
      l.label.style.opacity = show ? '1' : '0';
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
    let best: Item | null = null;
    if (this.mouse) {
      let bd = Infinity;
      for (const it of this.items) {
        const p = this.project(it.pos);
        const d = Math.hypot(p.x - this.mouse.x, p.y - this.mouse.y);
        const r = this.pixelRadius(it) + 12;
        if (d < r && d < bd) {
          bd = d;
          best = it;
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
