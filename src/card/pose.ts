/**
 * The card's pose, and moves between poses.
 *
 * No three.js and no DOM: a pose is three numbers, and a move is arithmetic
 * over time. Keeping it that way means the angle snapping — which is fiddly,
 * and which has already been wrong twice — can be tested rather than watched.
 */

export interface Pose {
  /** Pitch, radians. */
  rotX: number;
  /** Yaw, radians. Accumulates across flips rather than wrapping. */
  rotY: number;
  /** Camera distance as a multiple of the distance that just fits the card. */
  zoom: number;
}

/** Ease in and out. A move that starts and stops abruptly reads as a cut. */
export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

const TAU = 2 * Math.PI;

/**
 * Dead-on front, at least half a turn away.
 *
 * The smallest full-turn boundary at or beyond half a turn from here, so the
 * card always visibly turns over before it settles. Snapping to the *next*
 * boundary instead means a card already sitting just short of one barely
 * moves, and the turn is skipped entirely.
 */
export function squareFront(from: number): number {
  return Math.ceil((from + Math.PI) / TAU) * TAU;
}

/** The nearest dead-on front, in either direction. */
export function nearestFront(from: number): number {
  return Math.round(from / TAU) * TAU;
}

/**
 * The half-turn boundary roughly half a turn ahead, measured from `rest`.
 *
 * Rounded rather than floored, for the same reason as above: flooring snaps
 * to the next boundary, which is a few degrees away when the card is already
 * nearly there. Rounding keeps every flip between a half and one and a half
 * turns, from any starting angle.
 *
 * Snapping at all is what stops an interrupted flip leaving the card off-axis
 * — "current plus half a turn" compounds the error every time it is cut short.
 */
export function nextHalfTurn(from: number, rest = 0): number {
  const turns = (from - rest) / Math.PI;
  return (Math.round(turns) + 1) * Math.PI + rest;
}

export interface PoseTween {
  readonly pose: Pose;
  /** Whether a move is running. */
  readonly busy: boolean;
  /** Jump straight to a pose, cancelling any move. */
  set(to: Partial<Pose>): void;
  /** Move to a pose over `time` seconds, then run `then`. */
  moveTo(to: Partial<Pose>, time: number, then?: () => void): void;
  cancel(): void;
  /** Advance by `dt` seconds. Returns true if the pose changed. */
  update(dt: number): boolean;
}

export function createPoseTween(initial: Pose): PoseTween {
  let pose: Pose = { ...initial };
  let move: { from: Pose; to: Pose; t: number; time: number; then?: () => void } | null = null;

  return {
    get pose(): Pose {
      return pose;
    },

    get busy(): boolean {
      return move !== null;
    },

    set(to: Partial<Pose>): void {
      move = null;
      pose = { ...pose, ...to };
    },

    moveTo(to: Partial<Pose>, time: number, then?: () => void): void {
      move = { from: { ...pose }, to: { ...pose, ...to }, t: 0, time, then };
    },

    cancel(): void {
      move = null;
    },

    update(dt: number): boolean {
      if (!move || dt <= 0) return false;
      move.t = Math.min(1, move.t + dt / move.time);
      const k = easeInOut(move.t);
      pose = {
        rotX: move.from.rotX + (move.to.rotX - move.from.rotX) * k,
        rotY: move.from.rotY + (move.to.rotY - move.from.rotY) * k,
        zoom: move.from.zoom + (move.to.zoom - move.from.zoom) * k,
      };
      if (move.t >= 1) {
        const done = move.then;
        // Cleared before the callback, so a move started from inside it is
        // not immediately thrown away.
        move = null;
        done?.();
      }
      return true;
    },
  };
}
