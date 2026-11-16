import { describe, expect, it } from "vitest";
import { Cloth, DEFAULT_PARAMS } from "./Cloth";

// No drag or damping, so these tests isolate integration from dissipation.
const freeParams = {
  ...DEFAULT_PARAMS, cols: 2, rows: 2, substeps: 4, dragCoefficient: 0, damping: 0,
};

describe("Cloth integration", () => {
  it("free-falls at g when there are no constraints or pins", () => {
    const c = new Cloth(freeParams);
    const y0 = c.pos[1]!;
    const t = 0.5;
    for (let i = 0; i < 60; i++) c.step(t / 60);
    const expected = y0 - 0.5 * freeParams.gravity * t * t;
    // Symplectic Euler carries O(h) error, so compare relatively rather than
    // to a fixed number of decimal places.
    expect(Math.abs(c.pos[1]! - expected) / Math.abs(expected)).toBeLessThan(0.01);
  });

  it("holds pinned particles exactly still", () => {
    const c = new Cloth(freeParams);
    const p = c.index(0, 0);
    c.pin(p);
    const before = [c.pos[p * 3]!, c.pos[p * 3 + 1]!, c.pos[p * 3 + 2]!];
    for (let i = 0; i < 120; i++) c.step(1 / 120);
    expect([c.pos[p * 3]!, c.pos[p * 3 + 1]!, c.pos[p * 3 + 2]!]).toEqual(before);
  });

  it("lays particles out row-major on the XY plane", () => {
    // Flat layout only when uncurled; the curled rest shape is covered in bend.test.ts.
    const c = new Cloth({ ...freeParams, cols: 3, rows: 2, spacing: 0.01, restCurlRadius: Infinity });
    expect(c.index(2, 1)).toBe(5);
    expect(c.pos[c.index(2, 0) * 3]!).toBeCloseTo(0.02, 6);
    expect(c.pos[c.index(0, 1) * 3 + 1]!).toBeCloseTo(-0.01, 6);
  });

  it("reset returns particles to the rest layout", () => {
    const c = new Cloth(freeParams);
    for (let i = 0; i < 30; i++) c.step(1 / 120);
    c.reset();
    expect(c.pos[1]!).toBe(0);
    expect(c.vel[1]!).toBe(0);
  });

  it("stays finite", () => {
    const c = new Cloth(freeParams);
    for (let i = 0; i < 500; i++) c.step(1 / 120);
    expect(c.allFinite()).toBe(true);
  });
});
