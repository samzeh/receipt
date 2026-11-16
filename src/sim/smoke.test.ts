import { describe, expect, it } from "vitest";

describe("harness", () => {
  it("runs typescript under vitest", () => {
    const xs: Float32Array = new Float32Array([1, 2, 3]);
    expect(xs.length).toBe(3);
  });
});
