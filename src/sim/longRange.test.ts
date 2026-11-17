import { describe, expect, it } from "vitest";
import { buildLongRange, solveLongRange } from "./constraints";

const spacing = 0.01;

/** invMass for a cols x rows grid with one pinned row. */
function pinnedRow(cols: number, rows: number, row: number): Float32Array {
  const invMass = new Float32Array(cols * rows).fill(1);
  for (let c = 0; c < cols; c++) invMass[row * cols + c] = 0;
  return invMass;
}

describe("buildLongRange", () => {
  it("anchors a column at its pinned row rather than assuming row 0", () => {
    // The printer clamps the newest row at the slot, so the anchor is the last
    // row, not the first.
    const cols = 2;
    const rows = 3;
    const set = buildLongRange(cols, rows, spacing, pinnedRow(cols, rows, rows - 1));

    expect(set.count).toBe(cols * (rows - 1));

    const k = Array.from({ length: set.count }, (_, i) => i).find(
      (i) => set.particle[i] === 0,
    );
    expect(k).toBeDefined();
    expect(set.anchor[k!]).toBe((rows - 1) * cols);
    expect(set.maxDist[k!]).toBeCloseTo((rows - 1) * spacing, 9);
  });

  it("still anchors at row 0 when that is the pinned row", () => {
    const cols = 2;
    const rows = 3;
    const set = buildLongRange(cols, rows, spacing, pinnedRow(cols, rows, 0));

    expect(set.count).toBe(cols * (rows - 1));
    const k = Array.from({ length: set.count }, (_, i) => i).find(
      (i) => set.particle[i] === (rows - 1) * cols,
    );
    expect(set.anchor[k!]).toBe(0);
    expect(set.maxDist[k!]).toBeCloseTo((rows - 1) * spacing, 9);
  });
});

describe("solveLongRange with a pinned last row", () => {
  it("caps a particle pulled away from the row it hangs from", () => {
    const cols = 2;
    const rows = 3;
    const invMass = pinnedRow(cols, rows, rows - 1);
    const set = buildLongRange(cols, rows, spacing, invMass);

    const pos = new Float32Array(cols * rows * 3);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        pos[i * 3] = c * spacing;
        pos[i * 3 + 1] = -r * spacing;
      }
    }
    // Drag particle 0 far below the anchor it should be tethered to.
    pos[1] = -10 * spacing;

    solveLongRange(set, pos, invMass);

    const anchor = (rows - 1) * cols;
    const d = Math.hypot(
      pos[0]! - pos[anchor * 3]!,
      pos[1]! - pos[anchor * 3 + 1]!,
      pos[2]! - pos[anchor * 3 + 2]!,
    );
    expect(d).toBeLessThanOrEqual((rows - 1) * spacing * 1.0001);
  });
});
