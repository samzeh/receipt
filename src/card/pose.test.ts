import { describe, expect, it, vi } from "vitest";
import {
  createPoseTween, easeInOut, nearestFront, nextHalfTurn, squareFront, type Pose,
} from "./pose";

const TAU = 2 * Math.PI;
const rest: Pose = { rotX: 0, rotY: 0, zoom: 1 };

/** A spread of starting angles right around the circle, including boundaries. */
const ANGLES = Array.from({ length: 48 }, (_, i) => (i / 48) * 2 * TAU - TAU);

describe("nextHalfTurn", () => {
  it("always turns the card at least half way round", () => {
    // The bug this replaces: snapping to the *next* boundary meant a card
    // sitting just short of one moved a few degrees and the flip vanished.
    for (const from of ANGLES) {
      const travel = Math.abs(nextHalfTurn(from) - from);
      expect(travel).toBeGreaterThan(Math.PI * 0.5);
    }
  });

  it("never turns it more than one and a half times round", () => {
    for (const from of ANGLES) {
      expect(Math.abs(nextHalfTurn(from) - from)).toBeLessThanOrEqual(Math.PI * 1.5 + 1e-9);
    }
  });

  it("lands on a half-turn boundary, so interruptions cannot accumulate", () => {
    for (const from of ANGLES) {
      const turns = nextHalfTurn(from) / Math.PI;
      expect(turns).toBeCloseTo(Math.round(turns), 9);
    }
  });

  it("measures its boundaries from the resting angle", () => {
    const tilt = -0.38;
    const turns = (nextHalfTurn(tilt + 0.2, tilt) - tilt) / Math.PI;
    expect(turns).toBeCloseTo(Math.round(turns), 9);
  });

  it("flips an untouched card exactly half a turn", () => {
    expect(nextHalfTurn(0)).toBeCloseTo(Math.PI, 9);
  });
});

describe("squareFront", () => {
  it("always lands dead-on front", () => {
    for (const from of ANGLES) {
      const turns = squareFront(from) / TAU;
      expect(turns).toBeCloseTo(Math.round(turns), 9);
    }
  });

  it("always turns over at least once on the way", () => {
    // Entering the card has to show the back before it shows the front.
    for (const from of ANGLES) {
      expect(squareFront(from) - from).toBeGreaterThanOrEqual(Math.PI - 1e-9);
    }
  });
});

describe("nearestFront", () => {
  it("snaps to the closest dead-on front in either direction", () => {
    expect(nearestFront(0.2)).toBeCloseTo(0, 9);
    expect(nearestFront(-0.2)).toBeCloseTo(0, 9);
    expect(nearestFront(TAU - 0.2)).toBeCloseTo(TAU, 9);
    expect(nearestFront(-TAU + 0.2)).toBeCloseTo(-TAU, 9);
  });

  it("leaves a pose that is already square where it is", () => {
    for (const turns of [-2, -1, 0, 1, 2]) {
      expect(nearestFront(turns * TAU)).toBeCloseTo(turns * TAU, 9);
    }
  });
});

describe("easeInOut", () => {
  it("starts and ends where it should", () => {
    expect(easeInOut(0)).toBeCloseTo(0, 9);
    expect(easeInOut(1)).toBeCloseTo(1, 9);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 9);
  });

  it("moves slowly at the ends and quickly through the middle", () => {
    expect(easeInOut(0.1)).toBeLessThan(0.1);
    expect(easeInOut(0.9)).toBeGreaterThan(0.9);
  });
});

describe("createPoseTween", () => {
  it("arrives exactly on target", () => {
    const tween = createPoseTween(rest);

    tween.moveTo({ rotY: Math.PI, zoom: 0.5 }, 0.5);
    for (let i = 0; i < 60; i++) tween.update(1 / 60);

    expect(tween.pose.rotY).toBeCloseTo(Math.PI, 9);
    expect(tween.pose.zoom).toBeCloseTo(0.5, 9);
    expect(tween.busy).toBe(false);
  });

  it("leaves untouched fields alone", () => {
    const tween = createPoseTween({ rotX: 0.3, rotY: 0, zoom: 2 });

    tween.moveTo({ rotY: 1 }, 0.2);
    for (let i = 0; i < 30; i++) tween.update(1 / 60);

    expect(tween.pose.rotX).toBeCloseTo(0.3, 9);
    expect(tween.pose.zoom).toBeCloseTo(2, 9);
  });

  it("runs its callback once, at the end", () => {
    const tween = createPoseTween(rest);
    const then = vi.fn();

    tween.moveTo({ rotY: 1 }, 0.2);
    tween.update(0.1);
    expect(then).not.toHaveBeenCalled();

    tween.moveTo({ rotY: 1 }, 0.2, then);
    for (let i = 0; i < 30; i++) tween.update(1 / 60);

    expect(then).toHaveBeenCalledTimes(1);
  });

  it("lets a callback start the next move", () => {
    // The way in is two moves chained this way, so the second must survive.
    const tween = createPoseTween(rest);

    tween.moveTo({ rotY: Math.PI }, 0.2, () => tween.moveTo({ zoom: 0.5 }, 0.2));
    for (let i = 0; i < 12; i++) tween.update(1 / 60);
    expect(tween.busy).toBe(true);

    for (let i = 0; i < 30; i++) tween.update(1 / 60);
    expect(tween.pose.zoom).toBeCloseTo(0.5, 9);
  });

  it("stops where it was when cancelled", () => {
    const tween = createPoseTween(rest);

    tween.moveTo({ rotY: 10 }, 1);
    tween.update(0.25);
    const caught = tween.pose.rotY;
    tween.cancel();
    tween.update(0.5);

    expect(tween.busy).toBe(false);
    expect(tween.pose.rotY).toBeCloseTo(caught, 9);
  });

  it("ignores a frame with no time in it", () => {
    const tween = createPoseTween(rest);

    tween.moveTo({ rotY: 1 }, 0.2);

    expect(tween.update(0)).toBe(false);
    expect(tween.pose.rotY).toBeCloseTo(0, 9);
  });
});
