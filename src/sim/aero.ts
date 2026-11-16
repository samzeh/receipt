export function buildTriangles(cols: number, rows: number): Int32Array {
  const tris = new Int32Array((cols - 1) * (rows - 1) * 6);
  const at = (c: number, r: number): number => r * cols + c;
  let k = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      tris[k++] = at(c, r);
      tris[k++] = at(c, r + 1);
      tris[k++] = at(c + 1, r);
      tris[k++] = at(c + 1, r);
      tris[k++] = at(c, r + 1);
      tris[k++] = at(c + 1, r + 1);
    }
  }
  return tris;
}

/**
 * Per-triangle aerodynamic drag against the face normal.
 *
 * A global velocity damp makes the whole sheet move as one, through syrup.
 * Resolving drag per face is what makes the edges lead and the middle lag, so a
 * flick travels down the strip as a ripple.
 */
export function applyAero(
  tris: Int32Array,
  pos: Float32Array,
  vel: Float32Array,
  invMass: Float32Array,
  airDensity: number,
  dragCoefficient: number,
  h: number,
): void {
  if (dragCoefficient === 0) return;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t]!;
    const b = tris[t + 1]!;
    const c = tris[t + 2]!;
    const e1x = pos[b * 3]! - pos[a * 3]!;
    const e1y = pos[b * 3 + 1]! - pos[a * 3 + 1]!;
    const e1z = pos[b * 3 + 2]! - pos[a * 3 + 2]!;
    const e2x = pos[c * 3]! - pos[a * 3]!;
    const e2y = pos[c * 3 + 1]! - pos[a * 3 + 1]!;
    const e2z = pos[c * 3 + 2]! - pos[a * 3 + 2]!;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const twiceArea = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (twiceArea < 1e-14) continue;
    nx /= twiceArea;
    ny /= twiceArea;
    nz /= twiceArea;
    const area = twiceArea / 2;
    const vx = (vel[a * 3]! + vel[b * 3]! + vel[c * 3]!) / 3;
    const vy = (vel[a * 3 + 1]! + vel[b * 3 + 1]! + vel[c * 3 + 1]!) / 3;
    const vz = (vel[a * 3 + 2]! + vel[b * 3 + 2]! + vel[c * 3 + 2]!) / 3;
    const vn = vx * nx + vy * ny + vz * nz;
    const mag = -0.5 * airDensity * dragCoefficient * area * vn * Math.abs(vn);
    const fx = (mag * nx) / 3;
    const fy = (mag * ny) / 3;
    const fz = (mag * nz) / 3;
    for (let v = 0; v < 3; v++) {
      const i = tris[t + v]!;
      const w = invMass[i]!;
      if (w === 0) continue;
      vel[i * 3] = vel[i * 3]! + fx * w * h;
      vel[i * 3 + 1] = vel[i * 3 + 1]! + fy * w * h;
      vel[i * 3 + 2] = vel[i * 3 + 2]! + fz * w * h;
    }
  }
}
