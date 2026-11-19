import { DoubleSide, GLSL3, ShaderMaterial } from 'three';
import { palette } from '../ui/tokens';
import { materialUniforms, surfaceGLSL, type MaterialKind } from '../render/materials';

/** Kept forms wear the material they were made in. */
export function createSpecimenMaterial(kind: MaterialKind) {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    transparent: true,
    // Surface nets winding isn't consistent; normals come from the field, so draw both sides.
    side: DoubleSide,
    uniforms: {
      uOpacity: { value: 0 },
      uFocus: { value: 1 }, // 1 normal, <1 recedes when another form is in focus
      uPlate: { value: palette.field },
      ...materialUniforms(kind),
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
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vView = cameraPosition - wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uOpacity, uFocus;
      uniform vec3 uPlate;
      in vec3 vLocal;
      in vec3 vN;
      in vec3 vView;
      in float vCurv;
      in float vComp;
      out vec4 fragColor;
      ${surfaceGLSL}
      void main() {
        vec3 n = normalize(vN);
        vec3 V = normalize(vView);
        // Line density was tuned for the larger sculpt view.
        vec3 col = shadeSurface(n, V, vLocal * 0.4, vCurv, vComp, 0.0, 1.0);
        col = mix(uPlate, col, mix(0.3, 1.0, uFocus));
        fragColor = vec4(col, uOpacity);
      }
    `,
  });
}
