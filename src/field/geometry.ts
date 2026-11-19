import { BufferAttribute, BufferGeometry } from 'three';
import type { Specimen } from '../specimen/specimen';

/**
 * A kept form's geometry, centred on its bounding sphere. Works on a copy of
 * the positions, so the stored specimen is never modified.
 */
export function specimenGeometry(spec: Specimen) {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(spec.mesh.positions.slice(), 3));
  geo.setAttribute('normal', new BufferAttribute(spec.mesh.normals, 3));
  geo.setAttribute('aCurv', new BufferAttribute(spec.mesh.curvature, 1));
  geo.setAttribute('aComp', new BufferAttribute(spec.mesh.compression, 1));
  geo.setIndex(new BufferAttribute(spec.mesh.indices, 1));
  geo.computeBoundingSphere();
  const bs = geo.boundingSphere!;
  geo.translate(-bs.center.x, -bs.center.y, -bs.center.z);
  geo.computeBoundingSphere();
  return { geo, radius: bs.radius };
}
