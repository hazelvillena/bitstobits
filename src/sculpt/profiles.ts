/**
 * Stroke profiles, as fractions of the brush radius. A profile tapers from
 * the root (full brush) to a fine tip; `power` shapes the taper (above 1
 * thins quickly, like a needle), `blend` is the fillet into the body.
 */
export interface Profile {
  tip: number;
  power: number;
  blend: number;
}
/** Default: a clean, rounded taper ending in a soft round tip. */
export const ROUNDED: Profile = { tip: 0.5, power: 0.85, blend: 0.65 };
/** A sharp, thin needle: an almost straight cone to a fine point. */
export const SPIKE: Profile = { tip: 0.02, power: 1.05, blend: 0.45 };

export function taper(n: number, r: number, p: Profile) {
  const radii: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    radii.push(r * (p.tip + (1 - p.tip) * Math.pow(1 - t, p.power)));
  }
  return radii;
}


/** Press: a soft, flat-bottomed pocket that keeps nearly the brush width. */
export const POCKET: Profile = { tip: 0.82, power: 0.6, blend: 0.32 };
