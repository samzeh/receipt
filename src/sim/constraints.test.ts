import { describe, expect, it } from "vitest";
import { Cloth, DEFAULT_PARAMS } from "./Cloth";
import { buildStructural } from "./constraints";

const spacing = DEFAULT_PARAMS.spacing;

function maxStretch(c: Cloth): number {
  const set = buildStructural(c.cols, c.rows, spacing, 0);
  let worst = 0;
  for (let k = 0; k < set.count; k++) {
    const i = set.ij[k * 2]!, j = set.ij[k * 2 + 1]!;
    const dx = c.pos[i * 3]! - c.pos[j * 3]!;
    const dy = c.pos[i * 3 + 1]! - c.pos[j * 3 + 1]!;
    const dz = c.pos[i * 3 + 2]! - c.pos[j * 3 + 2]!;
    const len = Math.hypot(dx, dy, dz);
    worst = Math.max(worst, Math.abs(len - set.rest[k]!) / set.rest[k]!);
  }
  return worst;
}

describe("buildStructural", () => {
  it("creates right and down neighbour constraints only", () => {
    const set = buildStructural(3, 2, spacing, 1);
    expect(set.count).toBe(7);
    expect(set.rest[0]!).toBeCloseTo(spacing, 9);
  });

  it("scales compliance by rest length", () => {
    const set = buildStructural(2, 1, spacing, 3);
    expect(set.compliance[0]!).toBeCloseTo(3 * spacing, 9);
  });
});

describe("Cloth with structural constraints", () => {
  it("keeps paper inextensible while hanging", () => {
    const c = new Cloth({ ...DEFAULT_PARAMS, rows: 40 });
    for (let col = 0; col < c.cols; col++) c.pin(c.index(col, 0));
    for (let i = 0; i < 600; i++) c.step(1 / 120);
    expect(c.allFinite()).toBe(true);
    expect(maxStretch(c)).toBeLessThan(0.02);
  });

  it("does not gain energy with gravity off", () => {
    const c = new Cloth({ ...DEFAULT_PARAMS, rows: 20, gravity: 0 });
    for (let col = 0; col < c.cols; col++) c.pin(c.index(col, 0));
    const mid = c.index(6, 10);
    c.pos[mid * 3 + 2] = 0.01;
    const energy = (): number => {
      let e = 0;
      for (let i = 0; i < c.count; i++) {
        if (c.invMass[i] === 0) continue;
        const m = 1 / c.invMass[i]!;
        e += 0.5 * m * (c.vel[i * 3]! ** 2 + c.vel[i * 3 + 1]! ** 2 + c.vel[i * 3 + 2]! ** 2);
      }
      return e;
    };
    for (let i = 0; i < 10; i++) c.step(1 / 120);
    const e0 = energy();
    for (let i = 0; i < 1000; i++) c.step(1 / 120);
    expect(energy()).toBeLessThanOrEqual(e0 * 1.05);
  });
});
