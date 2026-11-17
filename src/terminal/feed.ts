/**
 * The printing sequence, as a state machine over paper length.
 *
 * Pure arithmetic with no three.js and no cloth: the orchestrator asks how many
 * rows should exist now and appends that many. Keeping it that way means the
 * sequence can be tested headlessly, the way the solver is.
 *
 * Feed is measured in simulation time rather than wall time, for the same
 * reason the solver is: a dropped frame should slow the paper down, not teleport
 * it forward.
 */

export type FeedPhase = "idle" | "focusing" | "ready" | "printing" | "printed" | "torn";

export interface FeedOptions {
  /** Rows in the finished receipt. */
  totalRows: number;
  /** Metres of paper per grid row. */
  rowSpacing: number;
  /** Feed speed in metres per second. Real thermal printers run 100-250mm/s. */
  speed: number;
}

export interface Feed {
  readonly phase: FeedPhase;
  /** Rows emitted so far as a fraction of the finished receipt. */
  readonly progress: number;
  /** The terminal was clicked; the camera is moving in. */
  focus(): void;
  /** The camera has arrived and the terminal can be used. */
  arrive(): void;
  /** Begin printing. Ignored unless ready — later this is the card going in. */
  start(): void;
  /** Advance one simulation step. Returns how many rows to append now. */
  step(h: number): number;
  /** Detach the paper from the slot. Ignored until printing has finished. */
  tear(): void;
}

export function createFeed(options: FeedOptions): Feed {
  const { totalRows, rowSpacing, speed } = options;
  let phase: FeedPhase = "idle";
  let emitted = 0;
  let fed = 0;

  return {
    get phase(): FeedPhase {
      return phase;
    },

    get progress(): number {
      return totalRows > 0 ? emitted / totalRows : 1;
    },

    focus(): void {
      if (phase === "idle") phase = "focusing";
    },

    arrive(): void {
      if (phase === "focusing") phase = "ready";
    },

    start(): void {
      if (phase === "ready") phase = "printing";
    },

    step(h: number): number {
      if (phase !== "printing") return 0;
      fed += speed * h;
      // The epsilon keeps the row count off the mercy of float accumulation:
      // summing speed * h a few hundred times lands either side of an exact
      // row boundary, and landing just under would hold a row back a frame.
      const want = Math.min(totalRows, Math.floor(fed / rowSpacing + 1e-9));
      const rows = want - emitted;
      emitted = want;
      if (emitted >= totalRows) phase = "printed";
      return rows;
    },

    tear(): void {
      if (phase === "printed") phase = "torn";
    },
  };
}
