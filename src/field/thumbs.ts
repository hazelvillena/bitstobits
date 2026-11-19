import { Mesh, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { Specimen } from '../specimen/specimen';
import { specimenGeometry } from './geometry';
import { createSpecimenMaterial } from './specimenMaterial';

/** Renders small still images of kept forms for the grid view. Cached by id. */
export class Thumbnailer {
  private renderer: WebGLRenderer | null = null;
  private scene = new Scene();
  private camera = new PerspectiveCamera(26, 1, 0.1, 50);
  private cache = new Map<string, string>();

  private ensure() {
    if (this.renderer) return this.renderer;
    const canvas = document.createElement('canvas');
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(320, 320, false);
    this.renderer.setClearColor(0x000000, 0);
    this.camera.position.set(0, 0.35, 4.2);
    this.camera.lookAt(0, 0, 0);
    return this.renderer;
  }

  get(spec: Specimen): string {
    const hit = this.cache.get(spec.id);
    if (hit) return hit;
    const r = this.ensure();
    const { geo, radius } = specimenGeometry(spec);
    const mat = createSpecimenMaterial(spec.material);
    mat.uniforms.uOpacity.value = 1;
    const mesh = new Mesh(geo, mat);
    mesh.scale.setScalar(0.92 / radius);
    mesh.rotation.set(0.35, -0.6, 0);
    this.scene.add(mesh);
    r.render(this.scene, this.camera);
    const url = r.domElement.toDataURL('image/png');
    this.scene.remove(mesh);
    geo.dispose();
    mat.dispose();
    this.cache.set(spec.id, url);
    return url;
  }

  forget(id?: string) {
    if (id) this.cache.delete(id);
    else this.cache.clear();
  }
}
