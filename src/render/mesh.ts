import { BufferAttribute, BufferGeometry } from "three";
import { buildTriangles } from "../sim/aero";
import type { Cloth } from "../sim/Cloth";

/**
 * Builds the receipt surface. Positions start at the flat rest layout and are
 * replaced wholesale by the first `syncGeometry`, so they are only a placeholder.
 */
export function buildGeometry(cols: number, rows: number, spacing: number): BufferGeometry {
  const n = cols * rows;
  const position = new Float32Array(n * 3);
  const normal = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      position[i * 3] = c * spacing;
      position[i * 3 + 1] = -r * spacing;
      normal[i * 3 + 2] = 1;
      uv[i * 2] = cols === 1 ? 0 : c / (cols - 1);
      uv[i * 2 + 1] = rows === 1 ? 1 : 1 - r / (rows - 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(position, 3));
  g.setAttribute("normal", new BufferAttribute(normal, 3));
  g.setAttribute("uv", new BufferAttribute(uv, 2));
  // WebGL index buffers must be an unsigned type. buildTriangles returns an
  // Int32Array for the simulation's own use, which three maps to gl.INT and
  // drawElements rejects with INVALID_ENUM, drawing nothing at all.
  g.setIndex(new BufferAttribute(Uint32Array.from(buildTriangles(cols, rows)), 1));
  return g;
}

export function syncGeometry(geometry: BufferGeometry, cloth: Cloth): void {
  const position = geometry.getAttribute("position") as BufferAttribute;
  const normal = geometry.getAttribute("normal") as BufferAttribute;
  const pos = position.array as Float32Array;
  const nrm = normal.array as Float32Array;
  pos.set(cloth.pos);
  nrm.fill(0);

  const index = geometry.getIndex()!.array as ArrayLike<number>;
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t]!;
    const b = index[t + 1]!;
    const c = index[t + 2]!;
    const e1x = pos[b * 3]! - pos[a * 3]!;
    const e1y = pos[b * 3 + 1]! - pos[a * 3 + 1]!;
    const e1z = pos[b * 3 + 2]! - pos[a * 3 + 2]!;
    const e2x = pos[c * 3]! - pos[a * 3]!;
    const e2y = pos[c * 3 + 1]! - pos[a * 3 + 1]!;
    const e2z = pos[c * 3 + 2]! - pos[a * 3 + 2]!;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    for (let v = 0; v < 3; v++) {
      const i = index[t + v]!;
      nrm[i * 3] = nrm[i * 3]! + nx;
      nrm[i * 3 + 1] = nrm[i * 3 + 1]! + ny;
      nrm[i * 3 + 2] = nrm[i * 3 + 2]! + nz;
    }
  }
  for (let i = 0; i < nrm.length; i += 3) {
    const len = Math.hypot(nrm[i]!, nrm[i + 1]!, nrm[i + 2]!);
    if (len < 1e-20) {
      nrm[i + 2] = 1;
      continue;
    }
    nrm[i] = nrm[i]! / len;
    nrm[i + 1] = nrm[i + 1]! / len;
    nrm[i + 2] = nrm[i + 2]! / len;
  }
  position.needsUpdate = true;
  normal.needsUpdate = true;
  geometry.computeBoundingSphere();
}
