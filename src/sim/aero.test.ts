import { describe, expect, it } from "vitest";
import { applyAero, buildTriangles } from "./aero";

describe("buildTriangles", () => {
  it("emits two triangles per cell", () => {
    expect(buildTriangles(3, 4).length).toBe((3 - 1) * (4 - 1) * 2 * 3);
  });
});

describe("applyAero", () => {
  const tri = new Int32Array([0, 1, 2]);
  const pos = new Float32Array([0, 0, 0, 0.01, 0, 0, 0, 0.01, 0]);
  const invMass = new Float32Array([1 / 2.9e-6, 1 / 2.9e-6, 1 / 2.9e-6]);

  it("opposes motion along the face normal", () => {
    const vel = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    applyAero(tri, pos, vel, invMass, 1.225, 1.2, 1 / 480);
    expect(vel[2]!).toBeLessThan(1);
  });

  it("barely resists in-plane motion", () => {
    const vel = new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]);
    applyAero(tri, pos, vel, invMass, 1.225, 1.2, 1 / 480);
    expect(vel[0]!).toBeCloseTo(1, 6);
  });

  it("leaves pinned vertices alone", () => {
    const vel = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const pinned = new Float32Array([0, 1 / 2.9e-6, 1 / 2.9e-6]);
    applyAero(tri, pos, vel, pinned, 1.225, 1.2, 1 / 480);
    expect(vel[2]!).toBe(1);
  });
});
