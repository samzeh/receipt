import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import { Cloth, DEFAULT_PARAMS } from "../sim/Cloth";
import { createPointerRig, type Picker } from "./pointer";

function rig(makePick: (cloth: Cloth) => Picker) {
  const cloth = new Cloth({ ...DEFAULT_PARAMS, rows: 20 });
  for (let c = 0; c < cloth.cols; c++) cloth.pin(cloth.index(c, 0));
  const camera = new PerspectiveCamera(32, 1, 0.01, 10);
  camera.position.set(0.04, -0.18, 0.42);
  camera.lookAt(0.04, -0.18, 0);
  camera.updateMatrixWorld(true);
  return { cloth, camera, r: createPointerRig(cloth, camera, makePick(cloth)) };
}

const grabMid = (c: Cloth): Picker => () => ({
  particle: c.index(6, 10),
  point: new Vector3(0.04, -0.07, 0),
});

describe("createPointerRig", () => {
  it("grabs the picked particle on the next update", () => {
    const { cloth, r } = rig(grabMid);
    r.pointerDown(0, 0);
    expect(r.grabbing).toBe(false);
    r.update();
    expect(r.grabbing).toBe(true);
    expect(cloth.attached).toBe(cloth.index(6, 10));
  });

  it("grabs nothing when the pick misses", () => {
    const { cloth, r } = rig(() => () => null);
    r.pointerDown(0.9, 0.9);
    r.update();
    expect(r.grabbing).toBe(false);
    expect(cloth.attached).toBe(-1);
  });

  it("raycasts once per frame, not once per move event", () => {
    const pick = vi.fn<Picker>(() => null);
    const { r } = rig(() => pick);
    r.pointerDown(0, 0);
    for (let i = 0; i < 10; i++) r.pointerMove(i / 20, 0);
    r.update();
    expect(pick).toHaveBeenCalledTimes(1);
  });

  it("drags the attachment toward the cursor", () => {
    const { cloth, r } = rig(grabMid);
    r.pointerDown(0, 0);
    r.update();
    const x0 = cloth.pos[cloth.index(6, 10) * 3]!;
    r.pointerMove(0.6, 0);
    for (let i = 0; i < 40; i++) {
      r.update();
      cloth.step(1 / 120);
    }
    expect(cloth.pos[cloth.index(6, 10) * 3]!).toBeGreaterThan(x0);
  });

  it("converts pick points into cloth space before attaching", () => {
    // The mesh sits under a transformed parent, so a world-space hit point
    // would yank the particle tens of millimetres from the cursor.
    const cloth = new Cloth({ ...DEFAULT_PARAMS, rows: 20 });
    const camera = new PerspectiveCamera(32, 1, 0.01, 10);
    camera.position.set(0, 0, 0.4);
    camera.updateMatrixWorld(true);
    const attach = vi.spyOn(cloth, "attach");
    const offset = new Vector3(0.01, 0.02, 0.03);
    const r = createPointerRig(
      cloth,
      camera,
      () => ({ particle: 5, point: new Vector3(0.1, 0.2, 0.3) }),
      (v) => v.sub(offset),
    );
    r.pointerDown(0, 0);
    r.update();
    expect(attach).toHaveBeenCalledWith(
      5, expect.closeTo(0.09, 6), expect.closeTo(0.18, 6), expect.closeTo(0.27, 6),
    );
  });

  it("releases on pointer up", () => {
    const { cloth, r } = rig(grabMid);
    r.pointerDown(0, 0);
    r.update();
    r.pointerUp();
    expect(r.grabbing).toBe(false);
    expect(cloth.attached).toBe(-1);
  });
});
