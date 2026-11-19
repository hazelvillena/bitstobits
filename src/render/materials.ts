import { palette } from '../ui/tokens';

export type MaterialKind = 'pearl' | 'obsidian' | 'graphic' | 'lines';
export const MATERIALS: { kind: MaterialKind; name: string }[] = [
  { kind: 'pearl', name: 'Pearl' },
  { kind: 'obsidian', name: 'Obsidian' },
  { kind: 'graphic', name: 'Graphic' },
  { kind: 'lines', name: 'Lines' },
];
export const materialIndex = (m: MaterialKind) => MATERIALS.findIndex((x) => x.kind === m);

/** Uniforms every surface shader shares. */
export function materialUniforms(kind: MaterialKind) {
  return {
    uMaterial: { value: materialIndex(kind) },
    uInk: { value: palette.ink },
    uPaper: { value: palette.paper },
    uRose: { value: palette.rose },
    uMagenta: { value: palette.magenta },
    uUltra: { value: palette.ultramarine },
    uSignal: { value: palette.signal },
  };
}

/**
 * Surface shading, shared by the raymarched form and the kept meshes.
 * Colour is never decoration: every material reads the same data
 * (curvature, compression, heat), each in its own visual language.
 */
export const surfaceGLSL = /* glsl */ `
uniform int uMaterial;
uniform vec3 uInk, uPaper, uRose, uMagenta, uUltra, uSignal;

float hairline(float s, float width) {
  float w = fwidth(s);
  float f = abs(fract(s - 0.5) - 0.5) / max(w, 1e-4);
  return 1.0 - smoothstep(width - 0.5, width + 0.5, f);
}

// A soft studio: graded sky, darker floor, three softboxes.
vec3 studio(vec3 r) {
  float y = r.y * 0.5 + 0.5;
  vec3 col = mix(vec3(0.46, 0.49, 0.54), vec3(0.93, 0.95, 0.97), smoothstep(0.25, 0.75, y));
  col += vec3(1.0) * 1.6 * smoothstep(0.93, 0.99, dot(r, normalize(vec3(-0.55, 0.65, 0.5))));
  col += vec3(1.0, 0.93, 0.96) * 0.9 * smoothstep(0.9, 0.985, dot(r, normalize(vec3(0.85, 0.25, -0.2))));
  col += vec3(0.85, 0.92, 1.0) * 0.6 * smoothstep(0.82, 0.97, dot(r, normalize(vec3(0.1, -0.15, 1.0))));
  return col;
}

vec3 cosPalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(6.28318 * (c * t + d));
}

vec3 graphicRamp(float t) {
  // Hollows sink to deep green, open surfaces sit in lime, ridges lift to pale.
  vec3 c0 = vec3(0.04, 0.20, 0.17);
  vec3 c1 = vec3(0.16, 0.45, 0.27);
  vec3 c2 = vec3(0.56, 0.84, 0.16);
  vec3 c3 = vec3(0.80, 0.95, 0.36);
  vec3 c4 = vec3(0.95, 0.98, 0.80);
  if (t < 0.25) return mix(c0, c1, t / 0.25);
  if (t < 0.5) return mix(c1, c2, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c2, c3, (t - 0.5) / 0.25);
  return mix(c3, c4, (t - 0.75) / 0.25);
}

vec3 contourRamp(float c) {
  vec3 a = mix(uRose, uMagenta, smoothstep(0.0, -0.9, c));
  return mix(a, uUltra, smoothstep(0.05, 0.9, c));
}

/*
  n, V: unit normal and direction to the viewer (same space).
  p: object-space position (for contour lines).
  curv: signed mean curvature (convex > 0). comp: 0 stretched … 1 pressed.
*/
vec3 shadeSurfaceM(int mat, vec3 n, vec3 V, vec3 p, float curv, float comp, float heat, float ao) {
  float ndv = clamp(dot(n, V), 0.0, 1.0);
  vec3 L = normalize(vec3(-0.45, 0.8, 0.55));
  float diff = clamp(dot(n, L), 0.0, 1.0);
  float wrap = clamp(dot(n, L) * 0.5 + 0.5, 0.0, 1.0);
  vec3 R = reflect(-V, n);
  vec3 env = studio(R);
  vec3 H = normalize(L + V);
  vec3 col;

  if (mat == 0) {
    // Pearl: thin-film iridescence. Hue shifts with viewing angle and with
    // how the form was made: hollows run warm, ridges run cool.
    float film = (1.0 - ndv) * 0.85 + curv * 0.22 + (comp - 0.5) * 0.35;
    vec3 irid = cosPalette(film, vec3(0.80, 0.76, 0.86), vec3(0.20, 0.19, 0.16), vec3(1.0), vec3(0.02, 0.18, 0.36));
    vec3 base = mix(vec3(0.95, 0.93, 0.95), irid, 0.7);
    float fres = 0.08 + 0.92 * pow(1.0 - ndv, 4.0);
    col = base * (0.42 + 0.58 * wrap) * mix(0.62, 1.0, ao);
    col = mix(col, env * irid * 1.05, fres * 0.65);
    col += vec3(1.0) * pow(max(dot(n, H), 0.0), 90.0) * 0.55 * ao;
  } else if (mat == 1) {
    // Obsidian: black glass. Pressed areas carry a deep violet sheen.
    vec3 base = mix(vec3(0.028, 0.032, 0.045), vec3(0.06, 0.03, 0.09), comp);
    float fres = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
    col = base * (0.5 + 0.5 * diff);
    col += env * mix(0.06, 0.95, fres) * vec3(0.88, 0.92, 1.0) * mix(0.5, 1.0, ao);
    col += vec3(1.0) * pow(max(dot(n, H), 0.0), 260.0) * 1.6;
    col += uUltra * 0.09 * smoothstep(0.2, 1.0, curv) * ao;
  } else if (mat == 2) {
    // Graphic: a bold lime field mapped from curvature and pressure.
    float t = clamp(0.52 + curv * 0.55 - (comp - 0.5) * 0.7, 0.0, 1.0);
    vec3 base = graphicRamp(t);
    col = base * (0.66 + 0.42 * wrap) * mix(0.72, 1.0, ao);
    float fres = pow(1.0 - ndv, 3.0);
    col = mix(col, vec3(1.0, 0.97, 0.98), fres * 0.28);
    col += vec3(1.0) * pow(max(dot(n, H), 0.0), 40.0) * 0.22;
  } else {
    // Lines: the original contour drawing.
    vec3 shell = mix(vec3(0.83, 0.86, 0.89), uPaper * 1.02, wrap) * mix(0.72, 1.0, ao);
    float s = p.y * 30.0 * mix(0.7, 1.9, comp);
    float lineA = max(hairline(s, 0.55) * 0.62, hairline(s / 5.0, 0.9));
    vec3 lc = contourRamp(curv);
    col = mix(shell, lc, lineA * 0.9 * mix(0.55, 1.0, ao));
    float rim = pow(1.0 - ndv, 3.0);
    col = mix(col, uInk, smoothstep(0.55, 0.95, rim) * 0.55);
  }

  // Fresh touch glows and cools.
  col = mix(col, uSignal, heat * 0.35);
  return col;
}

vec3 shadeSurface(vec3 n, vec3 V, vec3 p, float curv, float comp, float heat, float ao) {
  return shadeSurfaceM(uMaterial, n, V, p, curv, comp, heat, ao);
}
`;
