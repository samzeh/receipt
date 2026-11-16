import type { BufferAttribute } from "three";
import { describe, expect, it } from "vitest";
import { Cloth, DEFAULT_PARAMS } from "../sim/Cloth";
import { buildGeometry, syncGeometry } from "./mesh";

const s = DEFAULT_PARAMS.spacing;
// Uncurled, so "flat sheet" assertions mean what they say.
const flat = { ...DEFAULT_PARAMS, cols: 4, rows: 4, restCurlRadius: Infinity };

describe("buildGeometry", () => {
  it("has one vertex per particle and two triangles per cell", () => {
    const g = buildGeometry(4, 5, s);
    expect(g.getAttribute("position").count).toBe(20);
    expect(g.getIndex()!.count).toBe((4 - 1) * (5 - 1) * 6);
  });

  it("indexes with an unsigned type WebGL accepts", () => {
    // An Int32Array index maps to gl.INT, which drawElements rejects.
    expect(buildGeometry(4, 5, s).getIndex()!.array).toBeInstanceOf(Uint32Array);
  });

  it("maps uvs with v=1 at the top", () => {
    const g = buildGeometry(3, 3, s);
    const uv = g.getAttribute("uv");
    expect(uv.getX(0)).toBeCloseTo(0, 6);
    expect(uv.getY(0)).toBeCloseTo(1, 6);
    expect(uv.getX(8)).toBeCloseTo(1, 6);
    expect(uv.getY(8)).toBeCloseTo(0, 6);
  });
});

describe("syncGeometry", () => {
  it("copies particle positions", () => {
    const c = new Cloth(flat);
    const g = buildGeometry(4, 4, s);
    c.pos[3 * 3 + 2] = 0.01;
    syncGeometry(g, c);
    expect(g.getAttribute("position").getZ(3)).toBeCloseTo(0.01, 6);
  });

  it("gives a flat sheet normals along +Z", () => {
    const c = new Cloth(flat);
    const g = buildGeometry(4, 4, s);
    syncGeometry(g, c);
    const n = g.getAttribute("normal");
    for (let i = 0; i < n.count; i++) {
      expect(n.getZ(i)).toBeCloseTo(1, 4);
      expect(n.getX(i)).toBeCloseTo(0, 4);
    }
  });

  it("tilts normals when the sheet bends", () => {
    const c = new Cloth(flat);
    const g = buildGeometry(4, 4, s);
    for (let col = 0; col < 4; col++) c.pos[c.index(col, 3) * 3 + 2] = 0.01;
    syncGeometry(g, c);
    expect(Math.abs(g.getAttribute("normal").getY(c.index(0, 3)))).toBeGreaterThan(0.05);
  });

  it("marks the attributes for upload", () => {
    const c = new Cloth(flat);
    const g = buildGeometry(4, 4, s);
    const version = (name: string) => (g.getAttribute(name) as BufferAttribute).version;
    const before = version("position");
    syncGeometry(g, c);
    expect(version("position")).toBeGreaterThan(before);
    expect(version("normal")).toBeGreaterThan(before);
  });
});
