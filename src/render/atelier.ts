import {
  BoxGeometry,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  EdgesGeometry,
  Mesh,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
} from 'three';
import { Volume } from '../sculpt/volume';
import { createClayMaterial, MAX_TIPS } from './clayMaterial';
import { createParticleSkin } from './particleSkin';
import { palette } from '../ui/tokens';

/** Plate I: the sculpting chamber. */
export class Atelier {
  readonly renderer: WebGLRenderer;
  readonly camera = new PerspectiveCamera(28, 1, 0.1, 50);
  readonly scene = new Scene();
  readonly object = new Group(); // rotates; volume lives in its local space
  readonly volume: Volume;
  readonly tips: Vector4[];

  private clay: ReturnType<typeof createClayMaterial>;
  private skin: ReturnType<typeof createParticleSkin>;
  private cage: LineSegments;
  private time = 0;
  private spin = new Vector2(); // angular velocity (x: yaw, y: pitch)
  private idle = 0;
  private dissolve = 0; // 0..1 accept animation
  private grow = 1; // 0..1 new lump animation
  private canvas: HTMLCanvasElement;
  private pixelRatio = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.pixelRatio = Math.min(window.devicePixelRatio, 1.75);

    this.camera.position.set(0, 0.2, 4.4);
    this.camera.lookAt(0, 0, 0);

    this.volume = new Volume(96);
    this.clay = createClayMaterial(this.volume);
    this.tips = this.clay.uniforms.uTips.value as Vector4[];
    const box = new Mesh(new BoxGeometry(2, 2, 2), this.clay);
    box.renderOrder = 1;
    this.object.add(box);

    this.skin = createParticleSkin(this.volume, 56000, this.tips);
    this.object.add(this.skin.points);

    // A sparse wire cage, the measured envelope around the matter.
    const cageGeo = new EdgesGeometry(new IcosahedronGeometry(1.12, 0));
    this.cage = new LineSegments(
      cageGeo,
      new LineBasicMaterial({ color: palette.signal, transparent: true, opacity: 0.4, depthWrite: false }),
    );
    this.scene.add(this.cage);

    this.object.rotation.set(0.25, -0.5, 0);
    this.scene.add(this.object);
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep the object comfortably framed in tall and wide panes.
    this.camera.fov = w / h < 0.8 ? 28 / Math.max(w / h, 0.45) * 0.8 : 28;
    this.camera.updateProjectionMatrix();
  }

  setPixelRatio(pr: number) {
    if (Math.abs(pr - this.pixelRatio) < 0.05) return;
    this.pixelRatio = pr;
    this.resize();
  }
  get currentPixelRatio() {
    return this.pixelRatio;
  }

  /** Inertial turntable. dx/dy in radians. */
  rotateBy(dx: number, dy: number) {
    this.spin.x += dx;
    this.spin.y += dy;
    this.idle = 0;
  }
  touch() {
    this.idle = 0;
  }

  setTips(points: { pos: Vector3; strength: number }[]) {
    const local = new Vector3();
    const n = Math.min(points.length, MAX_TIPS);
    for (let i = 0; i < n; i++) {
      this.toLocal(points[i].pos, local);
      this.tips[i].set(local.x, local.y, local.z, points[i].strength);
    }
    this.clay.uniforms.uTipCount.value = n;
    this.skin.material.uniforms.uTipCount.value = n;
  }

  toLocal(world: Vector3, out: Vector3) {
    out.copy(world);
    return this.object.worldToLocal(out);
  }
  toLocalDir(world: Vector3, out: Vector3) {
    const q = new Quaternion().copy(this.object.quaternion).invert();
    return out.copy(world).applyQuaternion(q);
  }

  /** Ray from canvas pixel → world ray. */
  ray(px: number, py: number, origin: Vector3, dir: Vector3) {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const ndc = new Vector3((px / w) * 2 - 1, -(py / h) * 2 + 1, 0.5);
    origin.copy(this.camera.position);
    dir.copy(ndc.unproject(this.camera)).sub(origin).normalize();
  }

  /**
   * Cast from a canvas pixel to the first visible surface of the form.
   * Returns the world hit, the view direction and the distance along the ray,
   * or null when the pixel misses the form. Used by both mouse and hands, so
   * a tool always lands on what the person sees.
   */
  castSurface(px: number, py: number): { point: Vector3; dir: Vector3; dist: number } | null {
    const o = new Vector3(), d = new Vector3();
    this.ray(px, py, o, d);
    const lo = this.toLocal(o.clone(), new Vector3());
    const ld = this.toLocal(o.clone().add(d), new Vector3()).sub(lo);
    const scale = ld.length();
    ld.normalize();
    const t = this.volume.raycast(lo, ld);
    if (t < 0) return null;
    const point = this.object.localToWorld(lo.addScaledVector(ld, t));
    return { point, dir: d, dist: t / scale };
  }

  /** World point at a given distance along the view ray through a pixel. */
  pointOnRay(px: number, py: number, dist: number, out: Vector3) {
    const o = new Vector3(), d = new Vector3();
    this.ray(px, py, o, d);
    return out.copy(o).addScaledVector(d, dist);
  }

  project(world: Vector3) {
    const v = world.clone().project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.canvas.clientWidth, y: (-v.y * 0.5 + 0.5) * this.canvas.clientHeight };
  }

  /** Start the hand-off animation. Resolves when the lump has dissolved. */
  dissolveOut(): Promise<void> {
    return new Promise((resolve) => {
      const step = () => {
        this.dissolve = Math.min(1, this.dissolve + 1 / 50);
        if (this.dissolve >= 1) resolve();
        else requestAnimationFrame(step);
      };
      step();
    });
  }
  growIn() {
    this.dissolve = 0;
    this.grow = 0;
  }

  update(dt: number) {
    this.time += dt;
    this.idle += dt;

    // Turntable with inertia; a slow idle drift when nobody is touching.
    const damp = Math.exp(-dt * 4);
    this.object.rotateOnWorldAxis(new Vector3(0, 1, 0), this.spin.x);
    this.object.rotateOnWorldAxis(new Vector3(1, 0, 0), this.spin.y);
    this.spin.multiplyScalar(damp);
    if (this.idle > 4) this.object.rotateOnWorldAxis(new Vector3(0, 1, 0), dt * 0.08 * Math.min(1, (this.idle - 4) / 3));

    this.cage.rotation.y += dt * 0.03;
    this.cage.rotation.x = Math.sin(this.time * 0.11) * 0.2;

    this.grow = Math.min(1, this.grow + dt * 0.9);
    const g = 1 - Math.pow(1 - this.grow, 3);
    const s = 0.35 + 0.65 * g;
    this.object.scale.setScalar(s);

    this.volume.cool(dt);
    this.volume.upload();

    const camLocal = this.object.worldToLocal(this.camera.position.clone());
    const u = this.clay.uniforms;
    u.uCam.value.copy(camLocal);
    u.uTime.value = this.time;
    u.uOpacity.value = (1 - this.dissolve) * g;
    const su = this.skin.material.uniforms;
    su.uTime.value = this.time;
    su.uDissolve.value = this.dissolve;
    su.uScale.value = this.renderer.getPixelRatio() * this.canvas.clientHeight / 900;
    su.uOpacity.value = g;
    (this.cage.material as LineBasicMaterial).opacity = 0.38 * (1 - this.dissolve) * g;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
