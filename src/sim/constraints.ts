export interface ConstraintSet {
  ij: Int32Array;
  rest: Float32Array;
  compliance: Float32Array;
  count: number;
}

export function makeSet(capacity: number): ConstraintSet {
  return {
    ij: new Int32Array(capacity * 2),
    rest: new Float32Array(capacity),
    compliance: new Float32Array(capacity),
    count: 0,
  };
}

export function push(
  set: ConstraintSet,
  i: number,
  j: number,
  rest: number,
  compliancePerMetre: number,
): void {
  const k = set.count++;
  set.ij[k * 2] = i;
  set.ij[k * 2 + 1] = j;
  set.rest[k] = rest;
  // Compliance is specified per metre of rest length so that macroscopic
  // stiffness is independent of mesh resolution.
  set.compliance[k] = compliancePerMetre * rest;
}

export function buildStructural(
  cols: number,
  rows: number,
  spacing: number,
  compliancePerMetre: number,
  restCurlRadius = Infinity,
): ConstraintSet {
  const set = makeSet((cols - 1) * rows + cols * (rows - 1));
  const at = (c: number, r: number): number => r * cols + c;
  // Across the width the sheet follows the roll arc, so the straight edge
  // between adjacent columns is the chord of one arc segment, not its length.
  const acrossRest = chordLength(spacing, restCurlRadius);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols - 1; c++) {
      push(set, at(c, r), at(c + 1, r), acrossRest, compliancePerMetre);
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols; c++) {
      push(set, at(c, r), at(c, r + 1), spacing, compliancePerMetre);
    }
  }
  return set;
}

export function solveDistance(
  set: ConstraintSet,
  pos: Float32Array,
  invMass: Float32Array,
  h: number,
): void {
  const h2 = h * h;
  for (let k = 0; k < set.count; k++) {
    const i = set.ij[k * 2]!;
    const j = set.ij[k * 2 + 1]!;
    const wi = invMass[i]!;
    const wj = invMass[j]!;
    const w = wi + wj;
    if (w === 0) continue;
    const dx = pos[i * 3]! - pos[j * 3]!;
    const dy = pos[i * 3 + 1]! - pos[j * 3 + 1]!;
    const dz = pos[i * 3 + 2]! - pos[j * 3 + 2]!;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-12) continue;
    const alphaTilde = set.compliance[k]! / h2;
    const dLambda = -(len - set.rest[k]!) / (w + alphaTilde);
    const nx = (dx / len) * dLambda;
    const ny = (dy / len) * dLambda;
    const nz = (dz / len) * dLambda;
    pos[i * 3] = pos[i * 3]! + wi * nx;
    pos[i * 3 + 1] = pos[i * 3 + 1]! + wi * ny;
    pos[i * 3 + 2] = pos[i * 3 + 2]! + wi * nz;
    pos[j * 3] = pos[j * 3]! - wj * nx;
    pos[j * 3 + 1] = pos[j * 3 + 1]! - wj * ny;
    pos[j * 3 + 2] = pos[j * 3 + 2]! - wj * nz;
  }
}

/**
 * Long-range attachments (Müller et al.). One constraint per particle bounding
 * its distance from its anchor by the geodesic distance through the sheet.
 *
 * A single Gauss-Seidel sweep per substep propagates tension only one link up a
 * chain, so a long hanging strip reaches a steady state that is visibly
 * stretched however many substeps you spend. These inequality constraints cap
 * the accumulated error directly, at O(particles) cost, instead of paying 3.5x
 * more substeps to converge the chain.
 */
export interface LongRangeSet {
  particle: Int32Array;
  anchor: Int32Array;
  maxDist: Float32Array;
  count: number;
}

export function buildLongRange(
  cols: number,
  rows: number,
  spacing: number,
  invMass: Float32Array,
): LongRangeSet {
  const set: LongRangeSet = {
    particle: new Int32Array(cols * rows),
    anchor: new Int32Array(cols * rows),
    maxDist: new Float32Array(cols * rows),
    count: 0,
  };
  for (let c = 0; c < cols; c++) {
    // A column hangs from whichever of its rows is pinned, which is not always
    // row 0: a sheet fed from a printer is clamped at its newest row instead.
    let anchorRow = -1;
    for (let r = 0; r < rows; r++) {
      if (invMass[r * cols + c] === 0) {
        anchorRow = r;
        break;
      }
    }
    // Only columns with a pinned row have an anchor to hang from.
    if (anchorRow < 0) continue;
    const anchor = anchorRow * cols + c;
    for (let r = 0; r < rows; r++) {
      if (r === anchorRow) continue;
      const k = set.count++;
      set.particle[k] = r * cols + c;
      set.anchor[k] = anchor;
      set.maxDist[k] = Math.abs(r - anchorRow) * spacing;
    }
  }
  return set;
}

export function solveLongRange(
  set: LongRangeSet,
  pos: Float32Array,
  invMass: Float32Array,
): void {
  for (let k = 0; k < set.count; k++) {
    const p = set.particle[k]!;
    if (invMass[p] === 0) continue;
    const a = set.anchor[k]!;
    const dx = pos[p * 3]! - pos[a * 3]!;
    const dy = pos[p * 3 + 1]! - pos[a * 3 + 1]!;
    const dz = pos[p * 3 + 2]! - pos[a * 3 + 2]!;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const max = set.maxDist[k]!;
    if (len <= max || len < 1e-12) continue;
    const s = max / len;
    pos[p * 3] = pos[a * 3]! + dx * s;
    pos[p * 3 + 1] = pos[a * 3 + 1]! + dy * s;
    pos[p * 3 + 2] = pos[a * 3 + 2]! + dz * s;
  }
}

export function chordLength(arcLength: number, radius: number): number {
  if (!Number.isFinite(radius) || radius <= 0) return arcLength;
  const half = arcLength / 2;
  return 2 * radius * Math.sin(half / radius);
}

/**
 * Bending as a skip-two distance constraint rather than a dihedral angle: rest
 * length is the chord subtending an arc of 2*spacing at the target curvature.
 * Reuses the distance solver and is unconditionally stable.
 *
 * Curl is applied across the width only. A rest curl on both axes produces a
 * corkscrew instead of a roll curl.
 */
/** Spans, in cells, at which bending is resisted. */
export const BEND_SPANS = [2, 4, 8] as const;

export function buildBend(
  cols: number,
  rows: number,
  spacing: number,
  compliancePerMetreAlong: number,
  compliancePerMetreAcross: number,
  restCurlRadius: number,
): ConstraintSet {
  let capacity = 0;
  for (const span of BEND_SPANS) {
    capacity += cols * Math.max(0, rows - span) + Math.max(0, cols - span) * rows;
  }
  const set = makeSet(capacity);
  const at = (c: number, r: number): number => r * cols + c;

  // Bending is resisted at several spans, not just between neighbours. One
  // Gauss-Seidel sweep per substep propagates a short-span constraint only one
  // cell, so a strip built from skip-two constraints alone stays floppy however
  // rigid each constraint is. The longer spans carry curvature across the sheet
  // in a single sweep, the way long-range attachments do for stretch.
  for (const span of BEND_SPANS) {
    const alongRest = span * spacing;
    for (let r = 0; r < rows - span; r++) {
      for (let c = 0; c < cols; c++) {
        push(set, at(c, r), at(c, r + span), alongRest, compliancePerMetreAlong);
      }
    }
    const acrossRest = chordLength(alongRest, restCurlRadius);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols - span; c++) {
        push(set, at(c, r), at(c + span, r), acrossRest, compliancePerMetreAcross);
      }
    }
  }
  return set;
}

/**
 * Long-range attachments anchored on one particle, for a sheet that is held
 * rather than pinned. The shortest path through a flat sheet between two
 * particles is the straight line in rest space, so that distance is the cap.
 */
export function buildLongRangeFrom(
  cols: number,
  rows: number,
  spacing: number,
  anchor: number,
): LongRangeSet {
  const n = cols * rows;
  const set: LongRangeSet = {
    particle: new Int32Array(n),
    anchor: new Int32Array(n),
    maxDist: new Float32Array(n),
    count: 0,
  };
  const ac = anchor % cols;
  const ar = Math.floor(anchor / cols);
  for (let i = 0; i < n; i++) {
    if (i === anchor) continue;
    const k = set.count++;
    set.particle[k] = i;
    set.anchor[k] = anchor;
    set.maxDist[k] = Math.hypot((i % cols) - ac, Math.floor(i / cols) - ar) * spacing;
  }
  return set;
}
