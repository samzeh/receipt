import { DirectionalLight } from "three";
import { describe, expect, it } from "vitest";
import { createStudio } from "./studio";

describe("createStudio", () => {
  it("frames the receipt from the front", () => {
    const s = createStudio(1.5);
    expect(s.camera.aspect).toBeCloseTo(1.5, 6);
    expect(s.camera.position.z).toBeGreaterThan(0);
    expect(s.camera.fov).toBeLessThan(45);
  });

  it("has a key, a rim and a fill", () => {
    const s = createStudio(1);
    expect(s.lights.length).toBe(3);
    const intensities = s.lights
      .filter((l): l is DirectionalLight => l instanceof DirectionalLight)
      .map((l) => l.intensity);
    expect(Math.max(...intensities)).toBeGreaterThan(Math.min(...intensities));
  });

  it("returns a PMREM-ready equirectangular gradient", () => {
    const s = createStudio(1);
    expect(s.environment.image.width).toBeGreaterThan(1);
    expect(s.environment.image.height).toBeGreaterThan(1);
  });
});
