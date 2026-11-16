import { applyAero, buildTriangles } from "./aero";
import {
  buildBend, buildLongRange, buildLongRangeFrom, buildStructural, makeSet,
  solveDistance, solveLongRange,
  type ConstraintSet, type LongRangeSet,
} from "./constraints";

/**
 * Substeps buy convergence that compliance alone cannot, but cost scales with
 * substeps times constraints. A short receipt is only a few hundred particles
 * and can afford a lot of them; a long one cannot, and leans on the
 * multi-scale bend constraints and long-range attachments to propagate instead.
 */
export function substepsFor(rows: number): number {
  return Math.min(16, Math.max(6, Math.round(750 / Math.max(1, rows))));
}

export interface ClothParams {
  cols: number;
  rows: number;
  spacing: number;
  arealDensity: number;
  gravity: number;
  substeps: number;
  stretchCompliancePerMetre: number;
  bendComplianceAlongPerMetre: number;
  bendComplianceAcrossPerMetre: number;
  restCurlRadius: number;
  dragCoefficient: number;
  airDensity: number;
  /** Linear velocity decay, per second. */
  damping: number;
  /** Radius of the patch a grab holds rigidly, in metres. */
  grabRadius: number;
  /** Compliance of the grab itself, m/N. Near zero welds the paper to the
   *  cursor; larger values let it lag behind, which reads as weight. */
  grabCompliance: number;
}

export const DEFAULT_PARAMS: ClothParams = {
  cols: 12,
  rows: 60,
  spacing: 0.08 / 11,
  arealDensity: 0.055,
  gravity: 9.81,
  substeps: 4,
  stretchCompliancePerMetre: 1e-5,
  bendComplianceAlongPerMetre: 4,
  bendComplianceAcrossPerMetre: 12,
  restCurlRadius: 0.5,
  dragCoefficient: 1.2,
  airDensity: 1.225,
  damping: 5,
  grabRadius: 0.012,
  grabCompliance: 0.03,
};

export class Cloth {
  readonly cols: number;
  rows: number;
  pos: Float32Array;
  prev: Float32Array;
  vel: Float32Array;
  invMass: Float32Array;
  protected params: ClothParams;

  constructor(params: ClothParams) {
    this.params = { ...params };
    this.cols = params.cols;
    this.rows = params.rows;
    const n = this.cols * this.rows;
    this.pos = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.invMass = new Float32Array(n);
    this.layOut(0, this.rows);
    this.structural = makeSet(0);
    this.bend = makeSet(0);
    this.tris = new Int32Array(0);
    this.rebuild();
  }

  protected structural: ConstraintSet;
  protected bend: ConstraintSet;
  protected tris: Int32Array;
  private grabbed = -1;
  /** Interpolation endpoints for the grab target, plus the live value. */
  private targetFrom = new Float32Array(3);
  private targetTo = new Float32Array(3);
  private target = new Float32Array(3);
  private divergedFlag = false;
  private grabPatch = new Int32Array(0);
  private grabOffsets = new Float32Array(0);

  /** Rebuilds everything that depends on the grid dimensions. */
  protected rebuild(): void {
    const p = this.params;
    this.structural = buildStructural(
      this.cols, this.rows, p.spacing, p.stretchCompliancePerMetre, p.restCurlRadius,
    );
    this.bend = buildBend(
      this.cols, this.rows, p.spacing,
      p.bendComplianceAlongPerMetre, p.bendComplianceAcrossPerMetre, p.restCurlRadius,
    );
    this.tris = buildTriangles(this.cols, this.rows);
    this.pinsDirty = true;
  }

  get attached(): number {
    return this.grabbed;
  }

  get diverged(): boolean {
    return this.divergedFlag;
  }

  /**
   * Holds a patch of particles rigidly, not a single vertex. Dragging one
   * vertex of the grid concentrates every bit of deformation at that point,
   * which is how cloth bunches; a fingertip pinches an area of paper.
   */
  attach(particle: number, x: number, y: number, z: number): void {
    this.grabbed = particle;
    this.targetFrom[0] = x;
    this.targetFrom[1] = y;
    this.targetFrom[2] = z;
    this.targetTo.set(this.targetFrom);
    this.target.set(this.targetFrom);

    const anchor = new Float32Array(3);
    const rest = new Float32Array(3);
    this.restPosition(particle, anchor);
    const radius = this.params.grabRadius;
    const members: number[] = [];
    const offsets: number[] = [];
    for (let i = 0; i < this.count; i++) {
      this.restPosition(i, rest);
      const dx = rest[0]! - anchor[0]!;
      const dy = rest[1]! - anchor[1]!;
      const dz = rest[2]! - anchor[2]!;
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) > radius) continue;
      members.push(i);
      offsets.push(dx, dy, dz);
    }
    this.grabPatch = Int32Array.from(members);
    this.grabOffsets = Float32Array.from(offsets);
  }

  /** Particles currently held, including the one under the cursor. */
  get patchSize(): number {
    return this.grabPatch.length;
  }

  moveAttachment(x: number, y: number, z: number): void {
    this.targetTo[0] = x;
    this.targetTo[1] = y;
    this.targetTo[2] = z;
  }

  detach(): void {
    this.grabbed = -1;
    this.grabPatch = new Int32Array(0);
    this.grabOffsets = new Float32Array(0);
  }

  nearestParticle(x: number, y: number, z: number): number {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.count; i++) {
      const d =
        (this.pos[i * 3]! - x) ** 2 +
        (this.pos[i * 3 + 1]! - y) ** 2 +
        (this.pos[i * 3 + 2]! - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /**
   * Grows the grid by one row. Exists to serve the deferred printer feed, which
   * will overwrite the new row's position from the emission point before
   * stepping; until then it starts at its rest position.
   */
  appendRow(): void {
    const grown = this.count + this.cols;
    const pos = new Float32Array(grown * 3);
    const prev = new Float32Array(grown * 3);
    const vel = new Float32Array(grown * 3);
    const invMass = new Float32Array(grown);
    pos.set(this.pos);
    prev.set(this.prev);
    vel.set(this.vel);
    invMass.set(this.invMass);
    this.pos = pos;
    this.prev = prev;
    this.vel = vel;
    this.invMass = invMass;
    this.rows += 1;
    this.layOut(this.rows - 1, this.rows);
    this.rebuild();
  }
  protected longRange: LongRangeSet | null = null;
  private pinsDirty = true;
  /** -2 means anchored on pinned columns; otherwise the anchoring particle. */
  private lraKey = -1;

  get count(): number {
    return this.cols * this.rows;
  }

  index(col: number, row: number): number {
    return row * this.cols + col;
  }

  protected particleMass(): number {
    const { spacing, arealDensity } = this.params;
    return arealDensity * spacing * spacing;
  }

  /**
   * Writes the rest layout for rows [from, to) and resets their state.
   *
   * Columns follow the roll arc across the width rather than a flat line. A
   * flat layout sits at an unstable equilibrium — every force is symmetric in
   * z, so a shortened across-width rest length never buckles into a curl — and
   * paper off a roll arrives already curled regardless.
   */
  protected layOut(from: number, to: number): void {
    const invMass = 1 / this.particleMass();
    const rest = new Float32Array(3);
    for (let row = from; row < to; row++) {
      for (let col = 0; col < this.cols; col++) {
        const i = this.index(col, row);
        this.restPosition(i, rest);
        this.pos[i * 3] = rest[0]!;
        this.pos[i * 3 + 1] = rest[1]!;
        this.pos[i * 3 + 2] = rest[2]!;
        this.prev[i * 3] = this.pos[i * 3]!;
        this.prev[i * 3 + 1] = this.pos[i * 3 + 1]!;
        this.prev[i * 3 + 2] = this.pos[i * 3 + 2]!;
        this.vel[i * 3] = 0;
        this.vel[i * 3 + 1] = 0;
        this.vel[i * 3 + 2] = 0;
        this.invMass[i] = invMass;
      }
    }
  }

  /** Rest-space position of a particle, following the roll arc across the width. */
  protected restPosition(i: number, out: Float32Array): void {
    const { spacing, restCurlRadius: radius } = this.params;
    const col = i % this.cols;
    const row = Math.floor(i / this.cols);
    const curled = Number.isFinite(radius) && radius > 0;
    const theta = curled ? (col * spacing - ((this.cols - 1) * spacing) / 2) / radius : 0;
    out[0] = curled ? radius * Math.sin(theta) : col * spacing;
    // Avoid -0 at row 0 so rest positions stay canonical.
    out[1] = row === 0 ? 0 : -row * spacing;
    out[2] = curled ? radius * (1 - Math.cos(theta)) : 0;
  }

  pin(particle: number): void {
    this.pinsDirty = true;
    this.invMass[particle] = 0;
    this.vel[particle * 3] = 0;
    this.vel[particle * 3 + 1] = 0;
    this.vel[particle * 3 + 2] = 0;
  }

  unpin(particle: number): void {
    this.pinsDirty = true;
    this.invMass[particle] = 1 / this.particleMass();
  }

  reset(): void {
    this.layOut(0, this.rows);
  }

  allFinite(): boolean {
    for (let i = 0; i < this.pos.length; i++) {
      if (!Number.isFinite(this.pos[i]!)) return false;
    }
    return true;
  }

  step(dt: number): void {
    const sub = Math.max(1, this.params.substeps);
    const h = dt / sub;
    for (let s = 0; s < sub; s++) {
      // Spread the grab target across the substeps. Snapping it once per frame
      // lets a rigid attachment arrive in substep one and then sit still, so
      // frame-end velocity collapses and a release imparts no flick.
      const t = (s + 1) / sub;
      for (let a = 0; a < 3; a++) {
        this.target[a] = this.targetFrom[a]! + (this.targetTo[a]! - this.targetFrom[a]!) * t;
      }
      this.substep(h);
    }
    this.targetFrom.set(this.targetTo);
    if (!this.allFinite()) {
      this.divergedFlag = true;
      this.detach();
      this.reset();
    }
  }

  protected substep(h: number): void {
    const g = this.params.gravity;
    const n = this.count;
    applyAero(
      this.tris, this.pos, this.vel, this.invMass,
      this.params.airDensity, this.params.dragCoefficient, h,
    );
    for (let i = 0; i < n; i++) {
      if (this.invMass[i] === 0) continue;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1]! - g * h;
      for (let a = 0; a < 3; a++) {
        this.prev[i * 3 + a] = this.pos[i * 3 + a]!;
        this.pos[i * 3 + a] = this.pos[i * 3 + a]! + this.vel[i * 3 + a]! * h;
      }
    }
    this.solve(h);
    // Aerodynamic drag goes as v squared, so it stops damping as the sheet
    // slows and a hanging strip drifts forever. Real paper also dissipates
    // internally; this linear term is that, and it is what makes it settle.
    const decay = this.params.damping > 0 ? Math.exp(-this.params.damping * h) : 1;
    for (let i = 0; i < n; i++) {
      if (this.invMass[i] === 0) continue;
      for (let a = 0; a < 3; a++) {
        this.vel[i * 3 + a] = ((this.pos[i * 3 + a]! - this.prev[i * 3 + a]!) / h) * decay;
      }
    }
    this.cancelNetMomentum();
  }

  /**
   * Internal forces cannot move the centre of mass, so on a free sheet with no
   * gravity any net velocity is solver error. Left alone it translates the
   * receipt out of frame and damping then freezes it wherever it drifted to.
   * Gravity and pins are real external influences, so this stands down for them.
   */
  private cancelNetMomentum(): void {
    if (this.grabbed >= 0 || this.params.gravity !== 0) return;
    const n = this.count;
    let vx = 0;
    let vy = 0;
    let vz = 0;
    for (let i = 0; i < n; i++) {
      if (this.invMass[i] === 0) return;
      vx += this.vel[i * 3]!;
      vy += this.vel[i * 3 + 1]!;
      vz += this.vel[i * 3 + 2]!;
    }
    if (n === 0) return;
    vx /= n;
    vy /= n;
    vz /= n;
    for (let i = 0; i < n; i++) {
      this.vel[i * 3] = this.vel[i * 3]! - vx;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1]! - vy;
      this.vel[i * 3 + 2] = this.vel[i * 3 + 2]! - vz;
    }
  }

  protected solve(h: number): void {
    // A held sheet needs the same stretch cap a pinned one does, anchored on
    // whatever particle is currently carrying it.
    const key = this.invMass.some((m) => m === 0) ? -2 : this.grabbed;
    if (this.pinsDirty || key !== this.lraKey) {
      this.pinsDirty = false;
      this.lraKey = key;
      const { cols, rows } = this;
      const sp = this.params.spacing;
      this.longRange =
        key === -2
          ? buildLongRange(cols, rows, sp, this.invMass)
          : key >= 0
            ? buildLongRangeFrom(cols, rows, sp, key)
            : null;
    }
    solveDistance(this.structural, this.pos, this.invMass, h);
    solveDistance(this.bend, this.pos, this.invMass, h);
    if (this.longRange) solveLongRange(this.longRange, this.pos, this.invMass);
    this.solveAttachment(h);
  }

  private solveAttachment(h: number): void {
    if (this.grabbed < 0) return;
    const alphaTilde = this.params.grabCompliance / (h * h);
    for (let k = 0; k < this.grabPatch.length; k++) {
      const i = this.grabPatch[k]!;
      const w = this.invMass[i]!;
      if (w === 0) continue;
      const dx = this.pos[i * 3]! - (this.target[0]! + this.grabOffsets[k * 3]!);
      const dy = this.pos[i * 3 + 1]! - (this.target[1]! + this.grabOffsets[k * 3 + 1]!);
      const dz = this.pos[i * 3 + 2]! - (this.target[2]! + this.grabOffsets[k * 3 + 2]!);
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-12) continue;
      const dLambda = -len / (w + alphaTilde);
      this.pos[i * 3] = this.pos[i * 3]! + (w * dLambda * dx) / len;
      this.pos[i * 3 + 1] = this.pos[i * 3 + 1]! + (w * dLambda * dy) / len;
      this.pos[i * 3 + 2] = this.pos[i * 3 + 2]! + (w * dLambda * dz) / len;
    }
  }
}
