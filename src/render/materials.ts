import { Color, Vector3, Vector4 } from 'three';

/**
 * Materials are data: a five-colour palette (dark to light) plus four
 * settings. Every surface uses the same shading model and the same mapping,
 * so any palette (one day, colours taken from a painting) becomes a finish:
 * - Body colour comes from the palette at a position set by the form's own
 *   data: hollows sit darker, ridges lighter, pressed areas shift down.
 * - Reflections look the palette up by reflection direction, so a metallic
 *   finish mirrors its own colours, like chrome in a coloured room.
 * - Iridescence slides that lookup with viewing angle and curvature.
 */
export interface MaterialPreset {
  key: string;
  name: string;
  palette: [string, string, string, string, string];
  metal: number; // 0 painted … 1 mirror
  gloss: number; // 0 soft … 1 sharp highlights
  film: number; // 0 none … 1 strong iridescent shift
  lines?: boolean; // contour drawing over the body
}

export const MATERIALS: MaterialPreset[] = [
  { key: 'lime', name: 'Lime', palette: ['#0a332b', '#297346', '#8fd629', '#ccf25c', '#f2facc'], metal: 0.12, gloss: 0.35, film: 0 },
  { key: 'chrome', name: 'Iridescent chrome', palette: ['#2b2f6b', '#6c7bd9', '#9fe3f0', '#f2b8e6', '#ffffff'], metal: 0.9, gloss: 0.85, film: 0.85 },
  { key: 'opal', name: 'Opal', palette: ['#b9b3d9', '#e6d6f0', '#d2efe8', '#fbe5d4', '#ffffff'], metal: 0.35, gloss: 0.7, film: 0.65 },
  { key: 'mercury', name: 'Mercury', palette: ['#23272e', '#626a75', '#adb4bd', '#e1e5ea', '#ffffff'], metal: 1, gloss: 0.95, film: 0.04 },
  { key: 'ultraviolet', name: 'Ultraviolet', palette: ['#16093a', '#4a1fa6', '#8d4bef', '#e06be8', '#f7d6ff'], metal: 0.85, gloss: 0.85, film: 0.5 },
  { key: 'aqua', name: 'Aqua chrome', palette: ['#0b3a4a', '#1a8fb0', '#5fe0e6', '#bff6f0', '#ffffff'], metal: 0.85, gloss: 0.85, film: 0.55 },
  { key: 'pearl', name: 'Pearl', palette: ['#b7b0d4', '#dccbe8', '#f2dde6', '#e3f0f2', '#ffffff'], metal: 0.25, gloss: 0.6, film: 0.7 },
  { key: 'obsidian', name: 'Obsidian', palette: ['#040507', '#0d0e19', '#231f39', '#55556f', '#e8ecf2'], metal: 0.95, gloss: 0.98, film: 0.05 },
  { key: 'lines', name: 'Lines', palette: ['#3b3fcf', '#d2237a', '#f0a3c4', '#d3d9de', '#f1f3f4'], metal: 0, gloss: 0.3, film: 0, lines: true },
];

export const DEFAULT_MATERIAL = 'lime';

/** Older saves used these names. */
const LEGACY: Record<string, string> = { graphic: 'lime' };

export function preset(key: string | undefined): MaterialPreset {
  const k = LEGACY[key ?? ''] ?? key;
  return MATERIALS.find((m) => m.key === k) ?? MATERIALS[0];
}

/** Uniform value for one material slot (a `Mat` struct in GLSL). */
export function materialValue(key: string) {
  const p = preset(key);
  return {
    pal: p.palette.map((c) => new Vector3().setFromColor(new Color(c))),
    prm: new Vector4(p.metal, p.gloss, p.film, p.lines ? 1 : 0),
  };
}

/** Writes a preset into an existing uniform (no shader recompile). */
export function applyMaterial(u: { value: ReturnType<typeof materialValue> }, key: string) {
  const v = materialValue(key);
  u.value.pal.forEach((c, i) => c.copy(v.pal[i]));
  u.value.prm.copy(v.prm);
}

/** CSS gradient of a palette, for swatches. */
export function swatch(key: string) {
  return `linear-gradient(135deg, ${preset(key).palette.join(', ')})`;
}

/**
 * Shared shading. Declare `uniform Mat uMat;` (more slots if needed) in the
 * shader, then call shade(uMat, …).
 */
export const surfaceGLSL = /* glsl */ `
struct Mat { vec3 pal[5]; vec4 prm; }; // prm: metal, gloss, film, lines

float hairline(float s, float width) {
  float w = fwidth(s);
  float f = abs(fract(s - 0.5) - 0.5) / max(w, 1e-4);
  return 1.0 - smoothstep(width - 0.5, width + 0.5, f);
}

vec3 pal5(Mat m, float t) {
  t = clamp(t, 0.0, 1.0) * 4.0;
  float i = min(floor(t), 3.0);
  float f = t - i;
  vec3 a = i < 0.5 ? m.pal[0] : i < 1.5 ? m.pal[1] : i < 2.5 ? m.pal[2] : m.pal[3];
  vec3 b = i < 0.5 ? m.pal[1] : i < 1.5 ? m.pal[2] : i < 2.5 ? m.pal[3] : m.pal[4];
  return mix(a, b, f);
}

// Three soft white studio lights, shared by every finish.
float softboxes(vec3 r) {
  return 1.6 * smoothstep(0.93, 0.99, dot(r, normalize(vec3(-0.55, 0.65, 0.5))))
       + 0.9 * smoothstep(0.9, 0.985, dot(r, normalize(vec3(0.85, 0.25, -0.2))))
       + 0.5 * smoothstep(0.82, 0.97, dot(r, normalize(vec3(0.1, -0.15, 1.0))));
}

const vec3 HEAT = vec3(0.66, 0.72, 0.18);

/*
  n, V: unit normal and direction to the viewer (same space).
  p: object-space position (for contour lines).
  curv: signed mean curvature (convex > 0). comp: 0 stretched … 1 pressed.
*/
vec3 shade(Mat m, vec3 n, vec3 V, vec3 p, float curv, float comp, float heat, float ao) {
  float metal = m.prm.x, gloss = m.prm.y, film = m.prm.z;
  float ndv = clamp(dot(n, V), 0.0, 1.0);
  vec3 L = normalize(vec3(-0.45, 0.8, 0.55));
  float wrap = clamp(dot(n, L) * 0.5 + 0.5, 0.0, 1.0);
  vec3 R = reflect(-V, n);
  vec3 H = normalize(L + V);

  // One mapping for every finish: the form's data picks the body colour.
  float tData = clamp(0.55 + curv * 0.42 - (comp - 0.5) * 0.6, 0.0, 1.0);
  vec3 body = pal5(m, mix(0.25, 0.9, tData));

  if (m.prm.w > 0.5) {
    // Lines: contour drawing in the palette's darker colours.
    vec3 shell = mix(vec3(0.83, 0.86, 0.89), m.pal[4], wrap) * mix(0.72, 1.0, ao);
    float s = p.y * 30.0 * mix(0.7, 1.9, comp);
    float lineA = max(hairline(s, 0.55) * 0.62, hairline(s / 5.0, 0.9));
    vec3 lc = pal5(m, clamp(0.5 - curv * 0.5, 0.0, 0.5));
    vec3 col = mix(shell, lc, lineA * 0.9 * mix(0.55, 1.0, ao));
    col = mix(col, m.pal[0] * 0.4, smoothstep(0.55, 0.95, pow(1.0 - ndv, 3.0)) * 0.55);
    return mix(col, HEAT, heat * 0.35);
  }

  // Reflections: the palette wrapped around the room, slid by iridescence.
  float shift = film * ((1.0 - ndv) * 0.7 + curv * 0.18 + (comp - 0.5) * 0.2);
  vec3 env = pal5(m, R.y * 0.42 + 0.5 + R.x * 0.1 + shift);
  env += vec3(softboxes(R)) * mix(0.35, 1.0, gloss);

  float fres = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
  vec3 diffuse = body * (0.5 + 0.55 * wrap) * mix(0.62, 1.0, ao);
  vec3 refl = env * mix(vec3(1.0), body * 1.3, metal * 0.25) * mix(0.55, 1.0, ao);
  vec3 col = mix(diffuse, refl, mix(fres * (0.25 + 0.6 * gloss), 0.95, metal));
  col += vec3(1.0) * pow(max(dot(n, H), 0.0), mix(24.0, 320.0, gloss)) * mix(0.15, 1.3, gloss) * ao;

  return mix(col, HEAT, heat * 0.35);
}
`;
