import {
  BoxGeometry,
  Group,
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
import { applyMaterial, DEFAULT_MATERIAL, preset } from './materials';

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
  private time = 0;
  private spin = new Vector2(); // angular velocity (x: yaw, y: pitch)
  private idle = 0;
  private dissolve = 0; // 0..1 accept animation
  private grow = 1; // 0..1 new lump animation
  private canvas: HTMLCanvasElement;
  private pixelRatio = 1;
  material = DEFAULT_MATERIAL;
  /** Brush radius in object units, mirrored to the shader outline. */
  brush = 0.12;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.pixelRatio = Math.min(window.devicePixelRatio, 1.5);

    this.camera.position.set(0, 0.2, 4.4);
    this.camera.lookAt(0, 0, 0);

    this.volume = new Volume(128);
    // Partial uploads: send only the changed z-layers with texSubImage3D.
    this.volume.uploadLayers = (tex, data, k0, k1, channels) => {
      const props = this.renderer.properties.get(tex) as { __webglTexture?: WebGLTexture };
      if (!props.__webglTexture || tex.version === 0) return false;
      const gl = this.renderer.getContext() as WebGL2RenderingContext;
      const n = tex.image.width;
      this.renderer.state.bindTexture(gl.TEXTURE_3D, props.__webglTexture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      const fmt = channels === 1 ? gl.RED : gl.RG;
      const type = channels === 1 ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
      gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, k0, n, n, k1 - k0 + 1, fmt, type, data, k0 * n * n * channels);
      return true;
    };
    this.clay = createClayMaterial(this.volume, this.material);
    this.tips = this.clay.uniforms.uTips.value as Vector4[];
    const box = new Mesh(new BoxGeometry(2, 2, 2), this.clay);
    box.renderOrder = 1;
    this.object.add(box);

    this.skin = createParticleSkin(this.volume, 56000, this.tips);
    this.object.add(this.skin.points);


    this.object.rotation.set(0.25, -0.5, 0);
    this.scene.add(this.object);
    this.setMaterial(this.material);
    this.resize();
  }

  setMaterial(key: string) {
    this.material = preset(key).key;
    applyMaterial(this.clay.uniforms.uMat, this.material);
    // The particle skin belongs to the line drawing; finishes stay clean.
    const lines = !!preset(key).lines;
    this.skin.material.uniforms.uSkin.value = lines ? 1 : 0;
    this.skin.material.uniforms.uSkinLight.value = 0;
    this.skin.points.visible = lines;
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Frame the whole working volume, not just the starting form: the
    // camera backs off until a sphere of radius FRAME fits in both
    // directions, so long extrusions and rotated forms never run off the
    // canvas edge. (The volume reaches 0.93 on each axis; extrusions stop
    // there, so about 1.3 from the centre covers them.)
    // Slightly less sideways room, so tall panes don't push the form too far away.
    const FRAME = 1.32, FRAME_X = 1.15;
    const t = Math.tan((this.camera.fov * Math.PI) / 360);
    const d = Math.max(FRAME / t, FRAME_X / (t * this.camera.aspect));
    this.camera.position.set(0, d * 0.045, d);
    this.camera.lookAt(0, 0, 0);
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
  /**
   * Turn the form directly by an angle (radians). It follows the hand while
   * held; a short glide continues after release.
   */
  rotateBy(dx: number, dy: number) {
    this.object.rotateOnWorldAxis(new Vector3(0, 1, 0), dx);
    this.object.rotateOnWorldAxis(new Vector3(1, 0, 0), dy);
    this.spin.set(dx, dy).multiplyScalar(0.6);
    this.held = true;
    this.idle = 0;
  }
  private held = false;
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

    // The form only turns when someone turns it (pinch and drag, or right drag).
    const damp = Math.exp(-dt * 4);
    if (!this.held) {
      this.object.rotateOnWorldAxis(new Vector3(0, 1, 0), this.spin.x);
      this.object.rotateOnWorldAxis(new Vector3(1, 0, 0), this.spin.y);
      this.spin.multiplyScalar(damp);
    }
    this.held = false;


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
    u.uBrush.value = this.brush;
    // One pixel's size in object units at distance 1 (object is uniformly scaled).
    const fovRad = (this.camera.fov * Math.PI) / 180;
    u.uPixel.value = (2 * Math.tan(fovRad / 2)) / (this.canvas.clientHeight * this.renderer.getPixelRatio()) / this.object.scale.x;
    const su = this.skin.material.uniforms;
    su.uTime.value = this.time;
    su.uDissolve.value = this.dissolve;
    su.uScale.value = this.renderer.getPixelRatio() * this.canvas.clientHeight / 900;
    su.uOpacity.value = g;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
