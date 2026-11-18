// Shader-side mirror of tokens.css. Keep in sync.
import { Color } from 'three';

export const palette = {
  ink: new Color('#1b2127'),
  paper: new Color('#f1f3f4'),
  plate: new Color('#f3f1ec'),
  rose: new Color('#f0a3c4'),
  magenta: new Color('#d2237a'),
  ultramarine: new Color('#3b3fcf'),
  signal: new Color('#a9b82e'),
};

export type TraitKey =
  | 'volume'
  | 'sphericity'
  | 'elongation'
  | 'genus'
  | 'concavity'
  | 'roughness'
  | 'compression';

export const traitHex: Record<TraitKey, string> = {
  volume: '#4f6b2a',
  sphericity: '#d2237a',
  elongation: '#1f7f86',
  genus: '#3b3fcf',
  concavity: '#6e4fc9',
  roughness: '#b7801a',
  compression: '#e07aa6',
};

export const traitLabel: Record<TraitKey, string> = {
  volume: 'Volume',
  sphericity: 'Sphericity',
  elongation: 'Elongation',
  genus: 'Apertures',
  concavity: 'Concavity',
  roughness: 'Roughness',
  compression: 'Compression',
};
