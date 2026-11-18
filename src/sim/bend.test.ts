import { describe, expect, it } from "vitest";
import { Cloth, DEFAULT_PARAMS, substepsFor } from "./Cloth";
import { BEND_SPANS, buildBend, buildStructural, chordLength } from "./constraints";

const s = DEFAULT_PARAMS.spacing;

describe("chordLength", () => {
  it("equals the arc length when flat", () => {
    expect(chordLength(2 * s, Infinity)).toBeCloseTo(2 * s, 9);
  });
  it("is shorter than the arc when curved", () => {
    const c = chordLength(2 * s, 0.045);
    expect(c).toBeLessThan(2 * s);
    expect(c).toBeCloseTo(2 * 0.045 * Math.sin(s / 0.045), 9);
  });
});

describe("buildBend", () => {
  it("resists bending at several spans, not just between neighbours", () => {
    const set = buildBend(12, 20, s, 1, 1, Infinity);
    const spans = new Set<number>();
    for (let k = 0; k < set.count; k++) spans.add(Math.round(set.rest[k]! / s));
    expect([...spans].sort((a, b) => a - b)).toEqual([...BEND_SPANS]);
  });

  it("curls across the width only", () => {
    const set = buildBend(12, 20, s, 1, 1, 0.045);
    let exact = 0;
    let shortened = 0;
    for (let k = 0; k < set.count; k++) {
      const spans = set.rest[k]! / s;
      if (Math.abs(spans - Math.round(spans)) < 1e-6) exact += 1;
      else shortened += 1;
    }
    // Along-strip spans keep their flat rest length; across-width ones chord.
    expect(exact).toBeGreaterThan(0);
    expect(shortened).toBeGreaterThan(0);
  });
});

describe("substepsFor", () => {
  it("spends substeps on short strips and economises on long ones", () => {
    expect(substepsFor(12)).toBe(16);
    expect(substepsFor(62)).toBe(12);
    expect(substepsFor(200)).toBe(6);
    expect(substepsFor(1000)).toBe(6);
  });
});

function hangFlat(p: Partial<typeof DEFAULT_PARAMS>, steps: number): Cloth {
  const c = new Cloth({ ...DEFAULT_PARAMS, ...p });
  for (let col = 0; col < c.cols; col++) c.pin(c.index(col, 0));
  for (let i = 0; i < steps; i++) c.step(1 / 120);
  return c;
}

/** Pins the left column so the sheet droops sideways as a cantilever plate. */
function cantilever(p: Partial<typeof DEFAULT_PARAMS>, steps: number): Cloth {
  const c = new Cloth({ ...DEFAULT_PARAMS, ...p });
  for (let row = 0; row < c.rows; row++) c.pin(c.index(0, row));
  for (let i = 0; i < steps; i++) c.step(1 / 120);
  return c;
}

describe("Cloth with bending", () => {
  it("develops curl across the width", () => {
    const c = hangFlat({ rows: 30, restCurlRadius: 0.045 }, 600);
    const edge = c.index(0, 20), mid = c.index(6, 20);
    expect(Math.abs(c.pos[mid * 3 + 2]! - c.pos[edge * 3 + 2]!)).toBeGreaterThan(0.002);
  });

  it("stays flat across the width when the curl radius is infinite", () => {
    const c = hangFlat({ rows: 30, restCurlRadius: Infinity }, 600);
    const edge = c.index(0, 20), mid = c.index(6, 20);
    expect(Math.abs(c.pos[mid * 3 + 2]! - c.pos[edge * 3 + 2]!)).toBeLessThan(5e-4);
  });

  // Twenty seconds, not the default five. This simulates two cantilevers to
  // convergence and takes six on its own; under a full parallel run it tips
  // past the default and fails for no reason anyone can act on.
  it("droops the same at two mesh resolutions of the same physical size", () => {
    // An 80mm square plate clamped along its left edge, at 12x12 and 23x23.
    // A hanging curtain would not exercise bending at all, so load it sideways.
    const droop = (n: number) => {
      const c = cantilever(
        { cols: n, rows: n, spacing: 0.08 / (n - 1), restCurlRadius: Infinity,
          substeps: substepsFor(n) },
        2000,
      );
      return c.pos[c.index(n - 1, Math.floor(n / 2)) * 3 + 1]!;
    };
    const coarse = droop(12), fine = droop(23);
    expect(Math.abs(fine - coarse) / Math.abs(coarse)).toBeLessThan(0.15);
  }, 20_000);

  it("keeps a 200-row strip inextensible", { timeout: 30_000 }, () => {
    const rows = 200;
    const c = hangFlat({ rows, substeps: substepsFor(rows) }, 600);
    const set = buildStructural(c.cols, rows, s, 0);
    let worst = 0;
    for (let k = 0; k < set.count; k++) {
      const i = set.ij[k * 2]!, j = set.ij[k * 2 + 1]!;
      const len = Math.hypot(
        c.pos[i * 3]! - c.pos[j * 3]!,
        c.pos[i * 3 + 1]! - c.pos[j * 3 + 1]!,
        c.pos[i * 3 + 2]! - c.pos[j * 3 + 2]!,
      );
      worst = Math.max(worst, Math.abs(len - s) / s);
    }
    expect(worst).toBeLessThan(0.02);
  });
});
