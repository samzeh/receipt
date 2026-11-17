import { describe, expect, it } from "vitest";
import { createStudio, enableShadows } from "./studio";

function pixels(studio: ReturnType<typeof createStudio>): Float32Array {
  return studio.environment.image.data as Float32Array;
}

describe("studio environment", () => {
  it("carries sources brighter than white", () => {
    // Clamping the environment to [0,1] is what turns a specular highlight
    // into a grey smudge. The softboxes have to be able to blow out.
    const data = pixels(createStudio(1));

    let brightest = 0;
    for (let i = 0; i < data.length; i += 4) brightest = Math.max(brightest, data[i]!);

    expect(brightest).toBeGreaterThan(1);
  });

  it("is brighter above than below, so edges have a horizon to catch", () => {
    const studio = createStudio(1);
    const { width: w, height: h } = studio.environment.image;
    const data = pixels(studio);

    const bandAverage = (row: number): number => {
      let sum = 0;
      for (let x = 0; x < w; x++) sum += data[(row * w + x) * 4]!;
      return sum / w;
    };

    expect(bandAverage(Math.floor(h * 0.15))).toBeGreaterThan(bandAverage(h - 1));
  });

  it("varies across the sky rather than being a flat wash", () => {
    const studio = createStudio(1);
    const { width: w, height: h } = studio.environment.image;
    const data = pixels(studio);

    const row = Math.floor(h * 0.2);
    let min = Infinity;
    let max = -Infinity;
    for (let x = 0; x < w; x++) {
      const v = data[(row * w + x) * 4]!;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }

    // A gradient alone has no structure for a glossy surface to reflect.
    expect(max).toBeGreaterThan(min * 4);
  });
});

describe("light studio", () => {
  it("keeps real darks, so a polished surface has something to reflect", () => {
    // A bright room with no dark in it renders a mirror as a flat grey card:
    // the metal reflects the environment, and a uniform dome averages to a
    // single tone. The contrast is the reflection.
    const data = pixels(createStudio(1, "light"));

    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < data.length; i += 4) {
      min = Math.min(min, data[i]!);
      max = Math.max(max, data[i]!);
    }

    expect(min).toBeLessThan(0.1);
    expect(max).toBeGreaterThan(5);
    expect(max / Math.max(min, 1e-6)).toBeGreaterThan(50);
  });

  it("is brighter on average than the dark room", () => {
    const average = (mode: "dark" | "light"): number => {
      const data = pixels(createStudio(1, mode));
      let sum = 0;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        sum += data[i]!;
        n += 1;
      }
      return sum / n;
    };

    expect(average("light")).toBeGreaterThan(average("dark") * 3);
  });
});

describe("enableShadows", () => {
  it("sizes the shadow frustum to the scene, not to metres", () => {
    const studio = createStudio(1);
    const radius = 0.14;

    enableShadows(studio, radius);

    const cam = studio.key.shadow.camera;
    expect(studio.key.castShadow).toBe(true);
    // The default frustum spans ten metres, which over a 185mm object leaves
    // a handful of texels on the whole machine.
    expect(cam.right - cam.left).toBeLessThan(radius * 10);
    expect(cam.right - cam.left).toBeGreaterThan(radius);
    expect(cam.far).toBeLessThan(radius * 20);
  });

  it("aims the key light at the point it was given", () => {
    const studio = createStudio(1);

    enableShadows(studio, 0.14, { x: 0, y: 0.03, z: 0 });

    expect(studio.key.target.position.y).toBeCloseTo(0.03, 6);
    expect(studio.key.position.y).toBeGreaterThan(studio.key.target.position.y);
  });
});
