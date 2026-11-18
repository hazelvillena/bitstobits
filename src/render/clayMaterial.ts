import { BackSide, GLSL3, ShaderMaterial, Vector3, Vector4 } from 'three';
import { palette } from '../ui/tokens';
import type { Volume } from '../sculpt/volume';

export const MAX_TIPS = 10;

/** Shared GLSL: contour ramp + line helpers (also used by specimen meshes). */
export const contourGLSL = /* glsl */ `
vec3 contourRamp(float c, vec3 rose, vec3 magenta, vec3 ultra) {
  // c < 0 concave · 0 flat · > 0 convex
  vec3 a = mix(rose, magenta, smoothstep(0.0, -0.9, c));
  return mix(a, ultra, smoothstep(0.05, 0.9, c));
}
float hairline(float s, float width) {
  float w = fwidth(s);
  float f = abs(fract(s - 0.5) - 0.5) / max(w, 1e-4);
  return 1.0 - smoothstep(width - 0.5, width + 0.5, f);
}
`;

export function createClayMaterial(vol: Volume) {
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
      uOpacity: { value: 1 },
      uInk: { value: palette.ink },
      uPaper: { value: palette.paper },
      uRose: { value: palette.rose },
      uMagenta: { value: palette.magenta },
      uUltra: { value: palette.ultramarine },
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
      uniform float uOpacity;
      uniform vec3 uInk, uPaper, uRose, uMagenta, uUltra, uSignal;

      ${contourGLSL}

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
        for (int i = 0; i < 110; i++) {
          float d = map(ro + rd * t);
          if (d < 0.0012) { hit = true; break; }
          t += max(d * 0.92, 0.0025);
          if (t > tb.y) break;
        }
        if (!hit) discard;
        vec3 p = ro + rd * t;

        // Normal + mean curvature from one 6-tap stencil.
        float e = uTexel * 2.0;
        float c0 = map(p);
        float xp = map(p + vec3(e,0,0)), xn = map(p - vec3(e,0,0));
        float yp = map(p + vec3(0,e,0)), yn = map(p - vec3(0,e,0));
        float zp = map(p + vec3(0,0,e)), zn = map(p - vec3(0,0,e));
        vec3 n = normalize(vec3(xp - xn, yp - yn, zp - zn));
        float lap = (xp + xn + yp + yn + zp + zn - 6.0 * c0) / (e * e);
        float curv = clamp(lap * 0.09, -1.5, 1.5);

        vec2 attr = texture(uAttr, p * 0.5 + 0.5).rg;
        float comp = attr.r, heat = attr.g;

        // Soft occlusion from the field itself.
        float ao = 0.0;
        for (int i = 1; i <= 4; i++) {
          float h = 0.035 * float(i);
          ao += (h - map(p + n * h)) / h * (0.5 / float(i));
        }
        ao = clamp(1.0 - ao * 0.75, 0.25, 1.0);

        vec3 V = -rd;
        float ndv = clamp(dot(n, V), 0.0, 1.0);
        vec3 L = normalize(vec3(-0.45, 0.85, 0.55));
        float diff = clamp(dot(n, L) * 0.5 + 0.5, 0.0, 1.0);

        // Porcelain shell.
        vec3 shell = mix(vec3(0.83, 0.86, 0.89), uPaper * 1.02, diff);
        shell *= mix(0.72, 1.0, ao);

        // Contours: slice planes in object space; density follows compression.
        float density = 30.0 * mix(0.7, 1.9, comp);
        float s = p.y * density;
        float minor = hairline(s, 0.55);
        float major = hairline(s / 5.0, 0.9);
        vec3 lineCol = contourRamp(curv, uRose, uMagenta, uUltra);
        float lineA = max(minor * 0.62, major) * mix(0.55, 1.0, ao);
        vec3 col = mix(shell, lineCol, lineA * 0.9);

        // Drawn silhouette.
        float rim = pow(1.0 - ndv, 3.0);
        col = mix(col, uInk, smoothstep(0.55, 0.95, rim) * 0.55);
        col = mix(col, lineCol, rim * 0.18);

        // Fresh touch: warm signal glow that cools.
        col = mix(col, uSignal, heat * 0.5);

        // Proximity of fingertips: measuring rings on the surface.
        for (int i = 0; i < ${MAX_TIPS}; i++) {
          if (i >= uTipCount) break;
          vec4 tip = uTips[i];
          float dist = length(p - tip.xyz);
          float reach = 0.32;
          if (dist < reach) {
            float f = 1.0 - dist / reach;
            float ring = hairline(dist * 38.0 - uTime * 1.5, 0.6);
            col = mix(col, uSignal, ring * f * f * 0.85 * tip.w);
            col = mix(col, uSignal, smoothstep(0.75, 1.0, f) * 0.35 * tip.w);
          }
        }

        fragColor = vec4(col, uOpacity);
        vec4 clip = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
        gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;
      }
    `,
  });
}
