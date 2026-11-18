import { DoubleSide, GLSL3, ShaderMaterial } from 'three';
import { palette } from '../ui/tokens';
import { contourGLSL } from '../render/clayMaterial';

/** The Contour language on a baked mesh. */
export function createSpecimenMaterial() {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    side: DoubleSide,
    transparent: true,
    uniforms: {
      uOpacity: { value: 0 },
      uFocus: { value: 1 }, // 1 normal, <1 recedes when another form is in focus
      uInk: { value: palette.ink },
      uPaper: { value: palette.plate },
      uRose: { value: palette.rose },
      uMagenta: { value: palette.magenta },
      uUltra: { value: palette.ultramarine },
    },
    vertexShader: /* glsl */ `
      in float aCurv;
      in float aComp;
      out vec3 vLocal;
      out vec3 vN;
      out vec3 vView;
      out float vCurv;
      out float vComp;
      void main() {
        vLocal = position;
        vCurv = aCurv;
        vComp = aComp;
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uOpacity, uFocus;
      uniform vec3 uInk, uPaper, uRose, uMagenta, uUltra;
      in vec3 vLocal;
      in vec3 vN;
      in vec3 vView;
      in float vCurv;
      in float vComp;
      out vec4 fragColor;
      ${contourGLSL}
      void main() {
        vec3 n = normalize(vN);
        vec3 V = normalize(vView);
        float ndv = clamp(dot(n, V), 0.0, 1.0);
        float diff = clamp(dot(n, normalize(vec3(-0.4, 0.8, 0.6))) * 0.5 + 0.5, 0.0, 1.0);
        vec3 shell = mix(vec3(0.86, 0.86, 0.85), uPaper * 1.02, diff);
        float s = vLocal.y * 11.0 * mix(0.8, 1.5, vComp);
        float lineA = max(hairline(s, 0.6) * 0.7, hairline(s / 4.0, 0.9));
        vec3 lineCol = contourRamp(vCurv, uRose, uMagenta, uUltra);
        vec3 col = mix(shell, lineCol, lineA * 0.9);
        float rim = pow(1.0 - ndv, 3.0);
        col = mix(col, uInk, smoothstep(0.55, 0.95, rim) * 0.5);
        col = mix(uPaper, col, uFocus);
        fragColor = vec4(col, uOpacity);
      }
    `,
  });
}
