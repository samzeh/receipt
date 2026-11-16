import { describe, expect, it } from "vitest";
import { Cloth, DEFAULT_PARAMS, substepsFor } from "./Cloth";

function hung(rows: number): Cloth {
  const c = new Cloth({ ...DEFAULT_PARAMS, rows, substeps: substepsFor(rows) });
  for (let col = 0; col < c.cols; col++) c.pin(c.index(col, 0));
  return c;
}

describe("grab", () => {
  it("pulls the grabbed particle toward the target", () => {
    const c = hung(20);
    const p = c.index(6, 15);
    c.attach(p, 0.05, -0.05, 0.05);
    const dist = () =>
      Math.hypot(c.pos[p * 3]! - 0.05, c.pos[p * 3 + 1]! + 0.05, c.pos[p * 3 + 2]! - 0.05);
    const before = dist();
    for (let i = 0; i < 60; i++) c.step(1 / 120);
    expect(dist()).toBeLessThan(before);
    expect(c.attached).toBe(p);
  });

  it("carries momentum through release", () => {
    const c = hung(20);
    const p = c.index(6, 15);
    c.attach(p, c.pos[p * 3]!, c.pos[p * 3 + 1]!, c.pos[p * 3 + 2]!);
    for (let i = 0; i < 20; i++) {
      c.moveAttachment(c.pos[p * 3]! + 0.01, c.pos[p * 3 + 1]!, c.pos[p * 3 + 2]!);
      c.step(1 / 120);
    }
    const speed = Math.hypot(c.vel[p * 3]!, c.vel[p * 3 + 1]!, c.vel[p * 3 + 2]!);
    c.detach();
    expect(c.attached).toBe(-1);
    expect(speed).toBeGreaterThan(0.05);
  });

  it("holds a patch of particles, not a single vertex", () => {
    // Dragging one vertex concentrates all deformation there and bunches the
    // sheet like cloth; a fingertip pinches an area.
    const c = hung(20);
    const p = c.index(6, 10);
    c.attach(p, 0, 0, 0);
    expect(c.patchSize).toBeGreaterThan(4);
    const tiny = new Cloth({ ...DEFAULT_PARAMS, rows: 20, grabRadius: 0 });
    tiny.attach(tiny.index(6, 10), 0, 0, 0);
    expect(tiny.patchSize).toBe(1);
  });

  it("drops the patch on release", () => {
    const c = hung(20);
    c.attach(c.index(6, 10), 0, 0, 0);
    c.detach();
    expect(c.patchSize).toBe(0);
  });

  it("finds the nearest particle to a point", () => {
    const c = hung(10);
    const target = c.index(3, 4);
    const i = c.nearestParticle(
      c.pos[target * 3]!, c.pos[target * 3 + 1]!, c.pos[target * 3 + 2]!,
    );
    expect(i).toBe(target);
  });

  it("survives an adversarial grab without going non-finite", () => {
    const c = hung(40);
    const p = c.index(6, 30);
    c.attach(p, 0, 0, 0);
    for (let i = 0; i < 1000; i++) {
      c.moveAttachment(Math.sin(i) * 5, Math.cos(i) * 5, Math.sin(i * 3) * 5);
      c.step(1 / 120);
    }
    expect(c.allFinite()).toBe(true);
  });
});

describe("damping", () => {
  const kinetic = (c: Cloth): number => {
    let e = 0;
    for (let i = 0; i < c.count; i++) {
      if (c.invMass[i] === 0) continue;
      e += c.vel[i * 3]! ** 2 + c.vel[i * 3 + 1]! ** 2 + c.vel[i * 3 + 2]! ** 2;
    }
    return e;
  };

  const swing = (damping: number): number => {
    const c = new Cloth({ ...DEFAULT_PARAMS, rows: 24, damping });
    for (let col = 0; col < c.cols; col++) c.pin(c.index(col, 0));
    for (let col = 0; col < c.cols; col++) c.vel[c.index(col, 18) * 3 + 2] = 0.5;
    for (let i = 0; i < 480; i++) c.step(1 / 120);
    return kinetic(c);
  };

  it("settles a disturbed sheet that quadratic drag alone leaves swinging", () => {
    // Drag goes as v squared, so it stops biting at low speed. Without a
    // linear term the sheet drifts indefinitely.
    expect(swing(DEFAULT_PARAMS.damping)).toBeLessThan(swing(0) * 0.5);
  });
});

describe("appendRow", () => {
  it("grows the grid and preserves existing positions", () => {
    const c = hung(12);
    const probe = c.index(5, 6);
    for (let i = 0; i < 60; i++) c.step(1 / 120);
    const kept = c.pos[probe * 3 + 1]!;
    c.appendRow();
    expect(c.rows).toBe(13);
    expect(c.count).toBe(12 * 13);
    expect(c.pos[probe * 3 + 1]!).toBeCloseTo(kept, 6);
  });

  it("keeps simulating after growing", () => {
    const c = hung(12);
    for (let i = 0; i < 5; i++) {
      c.appendRow();
      for (let k = 0; k < 20; k++) c.step(1 / 120);
    }
    expect(c.rows).toBe(17);
    expect(c.allFinite()).toBe(true);
  });
});
