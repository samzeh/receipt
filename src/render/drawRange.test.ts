import { describe, expect, it } from "vitest";
import { Cloth, DEFAULT_PARAMS } from "../sim/Cloth";
import { buildGeometry, syncGeometry } from "./mesh";

const s = DEFAULT_PARAMS.spacing;
const flat = { ...DEFAULT_PARAMS, cols: 4, restCurlRadius: Infinity };

const indicesFor = (cols: number, rows: number): number => (rows - 1) * (cols - 1) * 6;

describe("syncGeometry draw range", () => {
  // The printer feeds paper by growing the cloth, but reallocating the geometry
  // per row would thrash and rescale the UVs. Instead the geometry is built at
  // final length once and only the emerged rows are drawn.
  it("draws only the rows the cloth currently has", () => {
    const geometry = buildGeometry(4, 10, s);
    const cloth = new Cloth({ ...flat, rows: 3 });

    syncGeometry(geometry, cloth);

    expect(geometry.drawRange.start).toBe(0);
    expect(geometry.drawRange.count).toBe(indicesFor(4, 3));
  });

  it("draws the whole mesh once the cloth fills it", () => {
    const geometry = buildGeometry(4, 10, s);
    const cloth = new Cloth({ ...flat, rows: 10 });

    syncGeometry(geometry, cloth);

    expect(geometry.drawRange.count).toBe(indicesFor(4, 10));
  });

  it("grows the drawn range as rows are appended", () => {
    const geometry = buildGeometry(4, 10, s);
    const cloth = new Cloth({ ...flat, rows: 3 });

    syncGeometry(geometry, cloth);
    expect(geometry.drawRange.count).toBe(indicesFor(4, 3));

    cloth.appendRow();
    syncGeometry(geometry, cloth);

    expect(geometry.drawRange.count).toBe(indicesFor(4, 4));
  });
});
