import {
  BufferAttribute,
  BufferGeometry,
  GLSL3,
  NormalBlending,
  Points,
  ShaderMaterial,
  Vector4,
} from 'three';
import { palette } from '../ui/tokens';
import type { Volume } from '../sculpt/volume';
import { MAX_TIPS } from './clayMaterial';
import { rng } from '../sculpt/seed';

/**
 * Particles that live on the iso-surface. Positions are stateless:
 * each particle projects its drifting seed onto the surface in the vertex
 * shader, so sculpting never needs a particle update on the CPU.
 */
export function createParticleSkin(vol: Volume, count: number, tips: Vector4[]) {
  const seeds = new Float32Array(count * 3);
  const rand = new Float32Array(count);
  const r = rng(91);
  for (let i = 0; i < count; i++) {
    // Seed on a shell so most particles converge onto the outer surface.
    const u = r() * 2 - 1, a = r() * Math.PI * 2;
    const rad = 0.25 + r() * 0.65;
    const s = Math.sqrt(1 - u * u);
    seeds[i * 3] = Math.cos(a) * s * rad;
    seeds[i * 3 + 1] = u * rad;
    seeds[i * 3 + 2] = Math.sin(a) * s * rad;
    rand[i] = r();
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(seeds, 3));
  geo.setAttribute('aRand', new BufferAttribute(rand, 1));
  geo.boundingSphere = null;

  const mat = new ShaderMaterial({
    glslVersion: GLSL3,
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    uniforms: {
      uSdf: { value: vol.sdfTex },
      uAttr: { value: vol.attrTex },
      uTexel: { value: 1 / vol.n },
      uTime: { value: 0 },
      uScale: { value: 1 },
      uTips: { value: tips },
      uTipCount: { value: 0 },
      uDissolve: { value: 0 },
      uOpacity: { value: 1 },
      uInk: { value: palette.ink },
      uUltra: { value: palette.ultramarine },
      uMagenta: { value: palette.magenta },
      uSignal: { value: palette.signal },
    },
    vertexShader: /* glsl */ `
      precision highp sampler3D;
      uniform sampler3D uSdf;
      uniform sampler3D uAttr;
      uniform float uTexel, uTime, uScale, uDissolve;
      uniform vec4 uTips[${MAX_TIPS}];
      uniform int uTipCount;
      in float aRand;
      out float vAlpha;
      out float vComp;
      out float vHeat;
      out float vRand;

      float map(vec3 p) { return texture(uSdf, clamp(p * 0.5 + 0.5, 0.0, 1.0)).r; }
      vec3 grad(vec3 p) {
        float e = uTexel * 1.5;
        const vec2 k = vec2(1.0, -1.0);
        return normalize(
          k.xyy * map(p + k.xyy * e) + k.yyx * map(p + k.yyx * e) +
          k.yxy * map(p + k.yxy * e) + k.xxx * map(p + k.xxx * e));
      }
      mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c,0.,-s, 0.,1.,0., s,0.,c); }
      mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.,0.,0., 0.,c,s, 0.,-s,c); }

      void main() {
        // Slow drift: rotate the seed so its projection slides along the surface.
        float sp = (aRand - 0.5) * 0.12;
        vec3 p = rotY(uTime * sp) * rotX(uTime * sp * 0.6) * position;
        vec3 n = vec3(0.0, 1.0, 0.0);
        float d = 0.0;
        for (int i = 0; i < 5; i++) {
          d = map(p);
          n = grad(p);
          p -= n * d;
        }
        d = map(p);
        p += n * 0.006;

        // Fingertips scatter the skin.
        for (int i = 0; i < ${MAX_TIPS}; i++) {
          if (i >= uTipCount) break;
          vec3 dv = p - uTips[i].xyz;
          float dist = length(dv);
          float f = max(0.0, 1.0 - dist / 0.22);
          p += (normalize(dv + n * 0.3) * 0.07 + n * 0.03) * f * f * uTips[i].w;
        }

        // Dissolve: drift away to the right (toward the field).
        p += vec3(1.6 + aRand, 0.4 * (aRand - 0.5), 0.0) * uDissolve * uDissolve * (0.6 + aRand);

        vec2 attr = texture(uAttr, clamp(p * 0.5 + 0.5, 0.0, 1.0)).rg;
        vComp = attr.r; vHeat = attr.g; vRand = aRand;
        vAlpha = (1.0 - smoothstep(0.004, 0.03, abs(d))) * (1.0 - uDissolve);

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uScale * mix(0.8, 1.9, aRand * aRand * aRand) * (3.4 / -mv.z);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uInk, uUltra, uMagenta, uSignal;
      uniform float uOpacity;
      in float vAlpha;
      in float vComp;
      in float vHeat;
      in float vRand;
      out vec4 fragColor;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float r = length(c);
        if (r > 0.5) discard;
        float a = smoothstep(0.5, 0.2, r);
        vec3 col = mix(uUltra, uMagenta, smoothstep(0.55, 0.9, vComp));
        col = mix(col, uInk, step(0.7, vRand) * 0.6);
        col = mix(col, uSignal, vHeat);
        fragColor = vec4(col, a * vAlpha * uOpacity * mix(0.12, 0.6, vRand * vRand));
      }
    `,
  });

  const points = new Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 2;
  return { points, material: mat };
}
