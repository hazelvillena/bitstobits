import { BackSide, GLSL3, ShaderMaterial, Vector3, Vector4 } from 'three';
import type { Volume } from '../sculpt/volume';
import { palette } from '../ui/tokens';
import { materialValue, surfaceGLSL } from './materials';

export const MAX_TIPS = 10;

/** Raymarched form: the distance field rendered with the shared materials. */
export function createClayMaterial(vol: Volume, material: string) {
  const tips: Vector4[] = [];
  for (let i = 0; i < MAX_TIPS; i++) tips.push(new Vector4(0, 0, 0, 0));

  return new ShaderMaterial({
    glslVersion: GLSL3,
    side: BackSide,
    transparent: true,
    depthWrite: true,
    uniforms: {
      uSdf: { value: vol.sdfTex },
      uAttr: { value: vol.attrTex },
      uTexel: { value: 1 / vol.n },
      uCam: { value: new Vector3() },
      uTime: { value: 0 },
      uTips: { value: tips },
      uTipCount: { value: 0 },
      uBrush: { value: 0.12 },
      uPixel: { value: 0.001 }, // view-space size of one pixel at distance 1
      uOpacity: { value: 1 },
      uMat: { value: materialValue(material) },
      uInk: { value: palette.ink },
      uSignal: { value: palette.signal },
    },
    vertexShader: /* glsl */ `
      out vec3 vLocal;
      void main() {
        vLocal = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      precision highp sampler3D;
      in vec3 vLocal;
      out vec4 fragColor;
      uniform mat4 modelMatrix;
      uniform mat4 projectionMatrix;
      uniform sampler3D uSdf;
      uniform sampler3D uAttr;
      uniform float uTexel;
      uniform vec3 uCam;
      uniform float uTime;
      uniform vec4 uTips[${MAX_TIPS}];
      uniform int uTipCount;
      uniform float uBrush;
      uniform float uPixel;
      uniform float uOpacity;

      ${surfaceGLSL}
      uniform Mat uMat;
      uniform vec3 uInk, uSignal;

      float map(vec3 p) { return texture(uSdf, p * 0.5 + 0.5).r; }

      vec2 box(vec3 ro, vec3 rd) {
        vec3 inv = 1.0 / rd;
        vec3 t0 = (-1.0 - ro) * inv, t1 = (1.0 - ro) * inv;
        vec3 tmin = min(t0, t1), tmax = max(t0, t1);
        return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
      }

      void main() {
        vec3 ro = uCam;
        vec3 rd = normalize(vLocal - ro);
        vec2 tb = box(ro, rd);
        float t = max(tb.x, 0.0);
        bool hit = false;
        // Track the closest approach, for soft anti-aliased silhouettes.
        float dMin = 1e9, tMin = t;
        // Enough steps for rays that graze along long, thin extrusions; if the
        // budget runs out very close to the surface, that still counts as a hit.
        float dLast = 1.0;
        for (int i = 0; i < 260; i++) {
          float d = map(ro + rd * t);
          dLast = d;
          if (d < dMin) { dMin = d; tMin = t; }
          if (d < 0.0012) { hit = true; break; }
          t += max(d * 0.8, 0.0025);
          if (t > tb.y) break;
        }
        if (!hit && dLast < 0.006 && t <= tb.y) hit = true;
        float coverage = 1.0;
        if (!hit) {
          float fp = uPixel * tMin * 1.2;
          if (dMin > fp) discard;
          coverage = 1.0 - dMin / fp;
          t = tMin;
        }
        vec3 p = ro + rd * t;

        // Normal + mean curvature from one 6-tap stencil.
        float e = uTexel * 1.5;
        float c0 = map(p);
        float xp = map(p + vec3(e,0,0)), xn = map(p - vec3(e,0,0));
        float yp = map(p + vec3(0,e,0)), yn = map(p - vec3(0,e,0));
        float zp = map(p + vec3(0,0,e)), zn = map(p - vec3(0,0,e));
        vec3 n = normalize(vec3(xp - xn, yp - yn, zp - zn));
        // Curvature over a wider stencil: a tight one shows voxel steps as bands.
        float e2 = uTexel * 3.5;
        float lap = (map(p + vec3(e2,0,0)) + map(p - vec3(e2,0,0)) + map(p + vec3(0,e2,0))
                   + map(p - vec3(0,e2,0)) + map(p + vec3(0,0,e2)) + map(p - vec3(0,0,e2)) - 6.0 * c0) / (e2 * e2);
        float curv = clamp(lap * 0.09, -1.5, 1.5);

        vec2 attr = texture(uAttr, p * 0.5 + 0.5).rg;

        float ao = 0.0;
        for (int i = 1; i <= 4; i++) {
          float h = 0.035 * float(i);
          ao += (h - map(p + n * h)) / h * (0.5 / float(i));
        }
        ao = clamp(1.0 - ao * 0.75, 0.25, 1.0);

        vec3 col = shade(uMat, n, -rd, p, curv, attr.r, attr.g, ao);

        // Brush: one crisp outline of exactly the area a tool will touch.
        // Outline in ink, or light on dark finishes.
        float lum = dot(uMat.pal[2], vec3(0.3, 0.59, 0.11));
        vec3 ringCol = lum < 0.3 ? vec3(0.92, 0.94, 0.96) : uInk;
        for (int i = 0; i < ${MAX_TIPS}; i++) {
          if (i >= uTipCount) break;
          vec4 tip = uTips[i];
          float dist = length(p - tip.xyz);
          float fw = fwidth(dist);
          float ring = 1.0 - smoothstep(0.0, fw * 1.6, abs(dist - uBrush));
          col = mix(col, ringCol, ring * mix(0.35, 0.8, tip.w));
          float inside = 1.0 - smoothstep(uBrush - fw, uBrush, dist);
          col = mix(col, uSignal, inside * smoothstep(0.8, 1.0, tip.w) * 0.18);
        }

        fragColor = vec4(col, uOpacity * coverage);
        vec4 clip = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
        gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;
      }
    `,
  });
}
