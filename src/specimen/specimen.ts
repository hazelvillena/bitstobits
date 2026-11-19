import { get, set } from 'idb-keyval';
import type { Volume } from '../sculpt/volume';
import { meshVolume, type MeshData } from './mesher';
import { measure, type Signature, type SignatureRaw } from './signature';

export interface Specimen {
  id: string;
  no: number;
  name: string;
  createdAt: number;
  sig: Signature;
  raw: SignatureRaw;
  mesh: MeshData;
  material?: string;
}

// Plain descriptive names from the form's strongest traits.
const NOUN: [keyof Signature, string][] = [
  ['genus', 'Ring'],
  ['elongation', 'Spindle'],
  ['sphericity', 'Pebble'],
  ['concavity', 'Shell'],
  ['roughness', 'Knot'],
  ['compression', 'Stone'],
  ['volume', 'Mass'],
];
const ADJ: Record<keyof Signature, string> = {
  genus: 'open',
  elongation: 'long',
  sphericity: 'round',
  concavity: 'hollow',
  roughness: 'rough',
  compression: 'dense',
  volume: 'heavy',
};

// Typical values; a form is named for where it departs most from them.
const BASE: Signature = { genus: 0, sphericity: 0.55, elongation: 0.3, concavity: 0.3, roughness: 0.35, compression: 0.45, volume: 0.35 };

function nameFor(sig: Signature) {
  const ranked = [...NOUN].sort((a, b) => sig[b[0]] - BASE[b[0]] - (sig[a[0]] - BASE[a[0]]));
  const noun = sig.genus >= 0.25 ? 'Ring' : ranked[0][1];
  const second = ranked.find((r) => r[1] !== noun)!;
  return `${capital(ADJ[second[0]])} ${noun.toLowerCase()}`;
}
const capital = (s: string) => s[0].toUpperCase() + s.slice(1);

export function createSpecimen(vol: Volume, no: number, material: string): Specimen {
  const mesh = meshVolume(vol);
  const { sig, raw } = measure(vol, mesh);
  return {
    id: `f${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    no,
    name: nameFor(sig),
    createdAt: Date.now(),
    sig,
    raw,
    mesh,
    material,
  };
}

const KEY = 'b2b.specimens.v1';
export async function loadSpecimens(): Promise<Specimen[]> {
  try {
    return ((await get(KEY)) as Specimen[]) ?? [];
  } catch {
    return [];
  }
}
export async function saveSpecimens(list: Specimen[]) {
  try {
    await set(KEY, list);
  } catch {
    /* storage unavailable: the session still works */
  }
}
