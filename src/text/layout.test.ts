import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, gridRowsFor, layoutReceipt, MONO_ADVANCE_EM } from "./layout";

describe("layoutReceipt", () => {
  it("computes characters per line from the monospace advance", () => {
    const l = layoutReceipt("x");
    const o = DEFAULT_LAYOUT;
    expect(l.charsPerLine).toBe(
      Math.floor((o.widthMm - 2 * o.marginMm) / (o.fontSizeMm * MONO_ADVANCE_EM)),
    );
  });

  it("honours explicit newlines", () => {
    const l = layoutReceipt("A\nB\nC");
    expect(l.lines).toEqual(["A", "B", "C"]);
    expect(l.lineCount).toBe(3);
  });

  it("wraps on word boundaries", () => {
    const l = layoutReceipt("aaa bbb ccc ddd", { fontSizeMm: 2.6, widthMm: 80, marginMm: 33 });
    expect(l.charsPerLine).toBeLessThan(10);
    expect(l.lines.length).toBeGreaterThan(1);
    for (const line of l.lines) expect(line.length).toBeLessThanOrEqual(l.charsPerLine);
  });

  it("hard-breaks words longer than a line", () => {
    const l = layoutReceipt("x".repeat(200));
    for (const line of l.lines) expect(line.length).toBeLessThanOrEqual(l.charsPerLine);
    expect(l.lines.join("")).toBe("x".repeat(200));
  });

  it("preserves interior alignment spaces", () => {
    const l = layoutReceipt("ITEM          4.00");
    expect(l.lines[0]).toBe("ITEM          4.00");
  });

  it("derives physical length from the line count", () => {
    const l = layoutReceipt("A\nB");
    const o = DEFAULT_LAYOUT;
    const expected = o.padTopMm + 2 * o.fontSizeMm * o.lineHeightRatio + o.padBottomMm;
    expect(l.lengthMm).toBeCloseTo(expected, 6);
  });

  it("renders a short blank slip for empty text", () => {
    const l = layoutReceipt("");
    expect(l.lines).toEqual([]);
    expect(l.lineCount).toBe(0);
    expect(l.gridRows).toBe(12);
    expect(l.clamped).toBe(false);
  });

  it("clamps absurdly long input", () => {
    const l = layoutReceipt("line\n".repeat(5000));
    expect(l.gridRows).toBe(DEFAULT_LAYOUT.maxRows);
    expect(l.clamped).toBe(true);
  });
});

describe("gridRowsFor", () => {
  it("applies the spec formula with clamping", () => {
    const s = 80 / 11;
    expect(gridRowsFor(1450, s, 400).rows).toBe(Math.round(1450 / s) + 1);
    expect(gridRowsFor(1, s, 400).rows).toBe(12);
    expect(gridRowsFor(1e6, s, 400)).toEqual({ rows: 400, clamped: true });
  });
});
