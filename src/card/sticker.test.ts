import { describe, expect, it } from "vitest";
import { distanceToSolid, grownMask, workingSize } from "./sticker";

/** An alpha buffer with one solid pixel in the middle. */
function dot(size: number): Uint8Array {
  const alpha = new Uint8Array(size * size);
  alpha[Math.floor(size / 2) * size + Math.floor(size / 2)] = 255;
  return alpha;
}

/** A solid rectangle, to stand in for an opaque image. */
function block(w: number, h: number, x0: number, y0: number, x1: number, y1: number): Uint8Array {
  const alpha = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) alpha[y * w + x] = 255;
  }
  return alpha;
}

describe("distanceToSolid", () => {
  it("is zero on the shape itself", () => {
    const size = 21;
    const dist = distanceToSolid(dot(size), size, size);
    expect(dist[Math.floor(size / 2) * size + Math.floor(size / 2)]).toBe(0);
  });

  it("measures outward in every direction", () => {
    const size = 21;
    const mid = Math.floor(size / 2);
    const dist = distanceToSolid(dot(size), size, size);
    const probes: [number, number][] = [
      [5, 0],
      [-5, 0],
      [0, 5],
      [0, -5],
    ];
    for (const [dx, dy] of probes) {
      expect(dist[(mid + dy) * size + (mid + dx)]).toBeCloseTo(5, 5);
    }
  });

  it("is close to Euclidean on the diagonal", () => {
    // Chamfer weights are an approximation; a few percent is fine for a
    // border, but it should not be wildly off.
    const size = 31;
    const mid = Math.floor(size / 2);
    const dist = distanceToSolid(dot(size), size, size);
    const measured = dist[(mid + 7) * size + (mid + 7)]!;
    const exact = Math.hypot(7, 7);
    expect(Math.abs(measured - exact) / exact).toBeLessThan(0.07);
  });

  it("stays finite when nothing is solid", () => {
    const dist = distanceToSolid(new Uint8Array(9 * 9), 9, 9);
    for (const d of dist) expect(Number.isFinite(d)).toBe(true);
  });
});

describe("grownMask", () => {
  it("always contains the shape it grew from", () => {
    const w = 24;
    const h = 18;
    const alpha = block(w, h, 6, 5, 18, 13);
    const mask = grownMask(alpha, w, h, 4);
    for (let i = 0; i < alpha.length; i++) {
      if (alpha[i]! >= 24) expect(mask[i]).toBe(255);
    }
  });

  it("grows by about the radius asked for", () => {
    const w = 40;
    const h = 40;
    const alpha = block(w, h, 15, 15, 25, 25);
    const radius = 6;
    const mask = grownMask(alpha, w, h, radius);

    const row = 20;
    let left = 0;
    while (left < w && !mask[row * w + left]) left += 1;
    // The block starts at 15, so the border should reach about 15 - radius.
    expect(left).toBeGreaterThanOrEqual(15 - radius - 1);
    expect(left).toBeLessThanOrEqual(15 - radius + 1);
  });

  it("follows the shape rather than its bounding box", () => {
    // Two separate blobs stay separate: a bounding-box outline would join
    // them into one rectangle, which is the thing this must not do.
    const w = 40;
    const h = 12;
    const alpha = new Uint8Array(w * h);
    for (let y = 4; y < 8; y++) {
      for (let x = 3; x < 7; x++) alpha[y * w + x] = 255;
      for (let x = 33; x < 37; x++) alpha[y * w + x] = 255;
    }
    const mask = grownMask(alpha, w, h, 3);
    expect(mask[6 * w + 20]).toBe(0);
    expect(mask[6 * w + 5]).toBe(255);
    expect(mask[6 * w + 35]).toBe(255);
  });

  it("grows nothing at radius zero", () => {
    const w = 12;
    const h = 12;
    const alpha = block(w, h, 4, 4, 8, 8);
    const mask = grownMask(alpha, w, h, 0);
    for (let i = 0; i < alpha.length; i++) {
      expect(mask[i]).toBe(alpha[i]! >= 24 ? 255 : 0);
    }
  });

  it("leaves a fully transparent image empty", () => {
    const mask = grownMask(new Uint8Array(10 * 10), 10, 10, 5);
    for (const m of mask) expect(m).toBe(0);
  });
});

describe("workingSize", () => {
  it("scales a large export down to the longest side asked for", () => {
    expect(workingSize(2037, 2801, 512)).toEqual({ width: 372, height: 512 });
    expect(workingSize(2801, 2037, 512)).toEqual({ width: 512, height: 372 });
  });

  it("never scales a small one up", () => {
    // Enlarging would invent detail and blur the border it is measured from.
    expect(workingSize(200, 120, 512)).toEqual({ width: 200, height: 120 });
  });

  it("keeps the aspect ratio", () => {
    const fit = workingSize(2037, 2801, 400);
    expect(fit.width / fit.height).toBeCloseTo(2037 / 2801, 2);
  });

  it("never collapses to nothing", () => {
    const fit = workingSize(3000, 4, 100);
    expect(fit.width).toBeGreaterThan(0);
    expect(fit.height).toBeGreaterThan(0);
  });
});
