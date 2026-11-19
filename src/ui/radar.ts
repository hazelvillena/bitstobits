import type { Signature } from '../specimen/signature';
import type { TraitKey } from './tokens';

const AXES: { key: TraitKey; label: string }[] = [
  { key: 'sphericity', label: 'Round' },
  { key: 'elongation', label: 'Long' },
  { key: 'genus', label: 'Open' },
  { key: 'concavity', label: 'Hollow' },
  { key: 'roughness', label: 'Rough' },
  { key: 'compression', label: 'Dense' },
  { key: 'volume', label: 'Mass' },
];

/**
 * A radar of a form's traits, optionally overlaid with a relative's, so the
 * overlap reads at a glance. Returns an SVG string.
 */
/** Colours for overlaid relatives, in rank order. */
export const KIN_COLORS = ['#5f9e1a', '#3b3fcf', '#d2237a', '#1f7f86'];

export function radarSVG(a: Signature, kin: Signature[] = [], size = 208) {
  // Room around the chart for its labels.
  const c = size / 2, R = size / 2 - 34;
  const pt = (i: number, v: number) => {
    const ang = -Math.PI / 2 + (i / AXES.length) * Math.PI * 2;
    return [c + Math.cos(ang) * R * v, c + Math.sin(ang) * R * v];
  };
  const poly = (s: Signature) => AXES.map((ax, i) => pt(i, 0.08 + 0.92 * s[ax.key]).map((n) => n.toFixed(1)).join(',')).join(' ');

  const rings = [0.33, 0.66, 1]
    .map((k) => `<polygon class="r-ring" points="${AXES.map((_, i) => pt(i, k).join(',')).join(' ')}"/>`)
    .join('');
  const spokes = AXES.map((_, i) => {
    const [x, y] = pt(i, 1);
    return `<line class="r-spoke" x1="${c}" y1="${c}" x2="${x}" y2="${y}"/>`;
  }).join('');
  const labels = AXES.map((ax, i) => {
    const [x, y] = pt(i, 1.2);
    const anchor = Math.abs(x - c) < 4 ? 'middle' : x > c ? 'start' : 'end';
    return `<text class="r-label" x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle">${ax.label}</text>`;
  }).join('');
  // Relatives drawn faintest-first, so the closest sits on top.
  const others = kin
    .map((s, i) => ({ s, c: KIN_COLORS[i % KIN_COLORS.length], i }))
    .reverse()
    .map(({ s, c }) => `<polygon class="r-kin" style="stroke:${c};fill:${c}" points="${poly(s)}"/>`)
    .join('');
  return `<svg class="radar" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">${rings}${spokes}${others}<polygon class="r-self" points="${poly(a)}"/>${labels}</svg>`;
}
