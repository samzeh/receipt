import { Matrix4, Object3D, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { createKeypad } from "./keypad";

const options = {
  surfaceY: 0.034,
  centreZ: 0.05,
  keyWidth: 0.013,
  keyDepth: 0.009,
  keyGap: 0.002,
  keyHeight: 0.003,
};

/** Current world y of a key, read back out of its instance matrix. */
function keyY(pad: ReturnType<typeof createKeypad>, index: number): number {
  for (const mesh of pad.meshes) {
    for (let slot = 0; slot < mesh.count; slot++) {
      if (pad.indexAt(mesh, slot) !== index) continue;
      const m = new Matrix4();
      mesh.getMatrixAt(slot, m);
      return new Vector3().setFromMatrixPosition(m).y;
    }
  }
  throw new Error(`key ${index} is in no mesh`);
}

describe("createKeypad", () => {
  it("places every key above the surface it sits on", () => {
    const pad = createKeypad(options);

    expect(pad.keys).toHaveLength(16);
    for (const k of pad.keys) expect(k.position.y).toBeGreaterThan(options.surfaceY);

    pad.dispose();
  });

  it("resolves a raycast hit back to the key that was hit", () => {
    const pad = createKeypad(options);

    const seen = new Set<number>();
    for (const mesh of pad.meshes) {
      for (let slot = 0; slot < mesh.count; slot++) seen.add(pad.indexAt(mesh, slot));
    }

    expect(seen.size).toBe(16);
    expect(seen.has(-1)).toBe(false);

    pad.dispose();
  });

  it("reports no key for a hit on something else", () => {
    const pad = createKeypad(options);

    expect(pad.indexAt(new Object3D(), 0)).toBe(-1);
    expect(pad.indexAt(pad.meshes[0]!, undefined)).toBe(-1);

    pad.dispose();
  });

  it("pushes a pressed key down", () => {
    const pad = createKeypad(options);

    const before = keyY(pad, 5);
    pad.press(5);

    expect(keyY(pad, 5)).toBeLessThan(before);

    pad.dispose();
  });

  it("leaves its neighbours alone", () => {
    const pad = createKeypad(options);

    const before = keyY(pad, 6);
    pad.press(5);

    expect(keyY(pad, 6)).toBe(before);

    pad.dispose();
  });

  it("lets a pressed key rise back to rest", () => {
    const pad = createKeypad(options);

    const rest = keyY(pad, 5);
    pad.press(5);
    // Longer than the return time, in frame-sized slices.
    for (let i = 0; i < 30; i++) pad.update(1 / 60);

    expect(keyY(pad, 5)).toBeCloseTo(rest, 9);

    pad.dispose();
  });

  it("is still down part way through the return", () => {
    const pad = createKeypad(options);

    const rest = keyY(pad, 5);
    pad.press(5);
    pad.update(0.02);

    expect(keyY(pad, 5)).toBeLessThan(rest);

    pad.dispose();
  });

  it("ignores a press outside the pad", () => {
    const pad = createKeypad(options);

    expect(() => pad.press(-1)).not.toThrow();
    expect(() => pad.press(99)).not.toThrow();

    pad.dispose();
  });
});
