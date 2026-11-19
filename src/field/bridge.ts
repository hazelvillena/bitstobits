import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  GLSL3,
  Mesh,
  ShaderMaterial,
  Vector3,
} from 'three';
import { palette } from '../ui/tokens';
import { materialIndex, materialUniforms, surfaceGLSL, type MaterialKind } from '../render/materials';

const SEG = 72; // along
const RAD = 14; // around

/** Shape of a bridge, as fractions of the joined forms' radii. */
export const BRIDGE = {
  root: 0.15, // flared root where it leaves each form
  filament: [0.022, 0.05] as [number, number], // thin middle, from weak to strong kinship
  flare: 0.11, // how far along (0..1) the root flare reaches
  sway: 0.14, // S-curve amplitude, as a share of the span
  pull: 0.36, // how far the curve follows each surface normal before turning
};

/**
 * A symbiotic bridge: each form flares a root of its own matter toward its
 * relative, easing into one fine filament that flows between them. The bridge wears form A's
 * material on A's side and B's on B's side, blending at the waist, where a
 * thin band in the trait colour says why they are joined.
 */
export class Bridge {
  readonly mesh: Mesh;
  private pos: Float32Array;
  private nor: Float32Array;
  private mat: ShaderMaterial;

  constructor(matA: MaterialKind, matB: MaterialKind, trait: string) {
    const nv = (SEG + 1) * RAD;
    this.pos = new Float32Array(nv * 3);
    this.nor = new Float32Array(nv * 3);
    const tAttr = new Float32Array(nv);
    const idx: number[] = [];
    for (let i = 0; i <= SEG; i++) {
      for (let j = 0; j < RAD; j++) {
        tAttr[i * RAD + j] = i / SEG;
        if (i < SEG) {
          const a = i * RAD + j, b = i * RAD + ((j + 1) % RAD);
          const c = a + RAD, d = b + RAD;
          idx.push(a, c, b, b, c, d);
        }
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new BufferAttribute(this.nor, 3));
    geo.setAttribute('aT', new BufferAttribute(tAttr, 1));
    geo.setIndex(idx);

    this.mat = new ShaderMaterial({
      glslVersion: GLSL3,
      side: DoubleSide,
      transparent: true,
      uniforms: {
        ...materialUniforms(matA),
        uMatA: { value: materialIndex(matA) },
        uMatB: { value: materialIndex(matB) },
        uGrow: { value: 0 },
        uOpacity: { value: 1 },
        uFocus: { value: 1 },
        uTrait: { value: new Color(trait) },
        uPlate: { value: palette.field },
      },
      vertexShader: /* glsl */ `
        in float aT;
        out float vT;
        out vec3 vN;
        out vec3 vView;
        out vec3 vW;
        void main() {
          vT = aT;
          vN = normal;
          vW = position;
          vView = cameraPosition - position;
          gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform int uMatA, uMatB;
        uniform float uGrow, uOpacity, uFocus;
        uniform vec3 uTrait, uPlate;
        in float vT;
        in vec3 vN;
        in vec3 vView;
        in vec3 vW;
        out vec4 fragColor;
        ${surfaceGLSL}
        void main() {
          // Both lobes reach out from their forms and meet in the middle.
          float reach = uGrow * 0.5;
          if (vT > reach && vT < 1.0 - reach) discard;
          vec3 n = normalize(vN);
          vec3 V = normalize(vView);
          // The waist is a saddle: concave along the bridge.
          float waist = 1.0 - abs(vT - 0.5) * 2.0;
          float curv = mix(0.3, -0.2, waist);
          vec3 a = shadeSurfaceM(uMatA, n, V, vW, curv, 0.45, 0.0, 1.0);
          vec3 b = shadeSurfaceM(uMatB, n, V, vW, curv, 0.45, 0.0, 1.0);
          vec3 col = mix(a, b, smoothstep(0.38, 0.62, vT));
          // The reason: a fine band in the trait colour at the waist.
          float band = 1.0 - smoothstep(0.004, 0.008, abs(vT - 0.5));
          col = mix(col, uTrait, band * step(0.98, uGrow) * 0.9);
          col = mix(uPlate, col, mix(0.3, 1.0, uFocus));
          fragColor = vec4(col, uOpacity);
        }
      `,
    });
    this.mesh = new Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
  }

  /**
   * pa/pb: surface anchors, na/nb: outward normals there (world).
   * rA/rB: root radius at each form. filament: radius of the thin middle.
   * side: a direction across the bridge, for its S-curve. sway: -1..1.
   */
  update(
    pa: Vector3, na: Vector3, pb: Vector3, nb: Vector3,
    rA: number, rB: number, filament: number,
    side: Vector3, sway: number, grow: number, focus: number,
  ) {
    const span = pa.distanceTo(pb);
    // Roots start inside each form so the bridge reads as its own matter.
    const a0 = pa.clone().addScaledVector(na, -rA * 0.9);
    const b0 = pb.clone().addScaledVector(nb, -rB * 0.9);
    const bend = span * BRIDGE.sway * sway;
    const c1 = pa.clone().addScaledVector(na, span * BRIDGE.pull).addScaledVector(side, bend);
    const c2 = pb.clone().addScaledVector(nb, span * BRIDGE.pull).addScaledVector(side, -bend);

    const P = new Vector3(), T = new Vector3(), N = new Vector3(), B = new Vector3();
    const prevN = new Vector3();
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG, u = 1 - t;
      // Cubic Bezier through the anchors' normals.
      P.copy(a0).multiplyScalar(u * u * u)
        .addScaledVector(c1, 3 * u * u * t)
        .addScaledVector(c2, 3 * u * t * t)
        .addScaledVector(b0, t * t * t);
      T.copy(c1).sub(a0).multiplyScalar(3 * u * u)
        .addScaledVector(c2.clone().sub(c1), 6 * u * t)
        .addScaledVector(b0.clone().sub(c2), 3 * t * t)
        .normalize();
      // Parallel-transported frame, so the tube never twists.
      if (i === 0) {
        const ref = Math.abs(T.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
        N.crossVectors(T, ref).normalize();
      } else {
        N.copy(prevN).addScaledVector(T, -prevN.dot(T)).normalize();
      }
      prevN.copy(N);
      B.crossVectors(T, N);

      // Radius: a flared root at each form easing into a fine filament.
      const fa = Math.exp(-((t / BRIDGE.flare) ** 2));
      const fb = Math.exp(-(((1 - t) / BRIDGE.flare) ** 2));
      const r = (filament + (rA - filament) * fa + (rB - filament) * fb) * Math.min(1, grow * 1.6 + 0.25);

      for (let j = 0; j < RAD; j++) {
        const th = (j / RAD) * Math.PI * 2;
        const cx = Math.cos(th), sx = Math.sin(th);
        const k = (i * RAD + j) * 3;
        const nx = N.x * cx + B.x * sx, ny = N.y * cx + B.y * sx, nz = N.z * cx + B.z * sx;
        this.pos[k] = P.x + nx * r;
        this.pos[k + 1] = P.y + ny * r;
        this.pos[k + 2] = P.z + nz * r;
        this.nor[k] = nx;
        this.nor[k + 1] = ny;
        this.nor[k + 2] = nz;
      }
    }
    const g = this.mesh.geometry;
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('normal').needsUpdate = true;
    this.mat.uniforms.uGrow.value = grow;
    this.mat.uniforms.uFocus.value = focus;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
