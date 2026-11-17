import { describe, expect, it } from "vitest";
import { Cloth, DEFAULT_PARAMS } from "./Cloth";

// Uncurled, so a row's rest position across the width is a plain line and the
// assertions below are about the emission point alone.
const flat = { ...DEFAULT_PARAMS, cols: 3, rows: 2, restCurlRadius: Infinity };
const spacing = flat.spacing;

describe("Cloth.appendRow", () => {
  it("emits the new row at a given origin instead of its rest position", () => {
    // Paper is created at the printer's slot, not at the far end of the strip
    // where the rest layout would put it.
    const c = new Cloth(flat);

    c.appendRow([0.5, 0.25, -0.125]);

    const i = c.index(0, 2);
    expect(c.pos[i * 3]!).toBeCloseTo(0.5, 9);
    expect(c.pos[i * 3 + 1]!).toBeCloseTo(0.25, 9);
    expect(c.pos[i * 3 + 2]!).toBeCloseTo(-0.125, 9);
  });

  it("keeps the emitted row spread across the paper width", () => {
    // Collapsing the row to a point would make every across-width constraint
    // degenerate, and they spring apart from zero length when released.
    const c = new Cloth(flat);

    c.appendRow([0.5, 0.25, 0]);

    const left = c.index(0, 2);
    const right = c.index(2, 2);
    // 7dp, not 9: positions are float32, and once offset by a 0.5m emission
    // point the representable precision is around 3e-8.
    expect(c.pos[right * 3]! - c.pos[left * 3]!).toBeCloseTo(2 * spacing, 7);
  });

  it("emits the row at rest, with no inherited velocity", () => {
    const c = new Cloth(flat);

    c.appendRow([0.5, 0.25, 0]);

    const i = c.index(1, 2);
    expect(c.vel[i * 3]!).toBe(0);
    expect(c.vel[i * 3 + 1]!).toBe(0);
    expect(c.vel[i * 3 + 2]!).toBe(0);
  });

  it("still lays the row out at its rest position when given no origin", () => {
    const c = new Cloth(flat);

    c.appendRow();

    const i = c.index(0, 2);
    expect(c.pos[i * 3 + 1]!).toBeCloseTo(-2 * spacing, 9);
  });
});
