import { DataTexture, DoubleSide } from "three";
import { describe, expect, it } from "vitest";
import { createPaperMaterial, makeFibreNormalMap } from "./paperMaterial";

describe("makeFibreNormalMap", () => {
  it("is a square tiling RGBA texture", () => {
    const t = makeFibreNormalMap(64);
    expect(t.image.width).toBe(64);
    expect(t.image.height).toBe(64);
    expect((t.image.data as Uint8Array).length).toBe(64 * 64 * 4);
  });

  it("encodes mostly-flat normals around (0.5, 0.5, 1)", () => {
    const t = makeFibreNormalMap(32);
    const d = t.image.data as Uint8Array;
    expect(d[2]!).toBeGreaterThan(200);
    expect(Math.abs(d[0]! - 128)).toBeLessThan(60);
  });
});

describe("createPaperMaterial", () => {
  it("is double-sided translucent paper", () => {
    const m = createPaperMaterial(new DataTexture(), new DataTexture());
    expect(m.side).toBe(DoubleSide);
    expect(m.transmission).toBeGreaterThan(0);
    expect(m.thickness).toBeCloseTo(8e-5, 9);
    expect(m.roughness).toBeCloseTo(0.85, 6);
    expect(m.normalMap).not.toBeNull();
    expect(m.alphaTest).toBeGreaterThan(0);
  });
});
