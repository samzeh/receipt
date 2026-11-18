import { mulberry32 } from "../text/rng";
import type { CharacterPose } from "./sprites";

/**
 * The runner, as a simulation over texture pixels.
 *
 * Pure: no canvas, no three.js, no DOM. It knows the width of the field, the
 * size of the character and the size of a goose, and nothing else about how
 * any of it is drawn. Everything here is testable at a thousand steps a
 * millisecond, which is how the jump arc and the spacing were tuned.
 *
 * Units are texture pixels and seconds. Up is positive for `lift` and `vy`,
 * which is the opposite of the texture's y axis — the renderer subtracts.
 */

export interface GameOptions {
  /** Width of the field, in pixels. Geese enter from beyond it. */
  width: number;
  character: { x: number; width: number; height: number };
  goose: { width: number; height: number };
  seed?: number;
}

export interface Goose {
  /** Left edge, in pixels. */
  x: number;
  /** Wings up: the character is close enough to be worth threatening. */
  alert: boolean;
}

export interface GameState {
  time: number;
  /** Scroll speed, pixels per second. */
  speed: number;
  /** Pixels scrolled since the start. The score is a function of this. */
  distance: number;
  /** Height of the character's feet above the ground. */
  lift: number;
  vy: number;
  grounded: boolean;
  geese: Goose[];
  /** Distance at which the next goose appears. */
  nextSpawnAt: number;
  over: boolean;
  score: number;
}

export interface Game {
  readonly state: GameState;
  /** Which frame of the character to draw right now. */
  readonly pose: CharacterPose;
  jump(): void;
  step(dt: number): void;
  reset(): void;
}

export const PHYSICS = {
  /** Pixels per second squared. */
  gravity: 950,
  /** Take-off speed. With this gravity the arc peaks at ~44px, a little
   *  over three geese high, and lasts about 0.6s. */
  jumpSpeed: 290,
  speed0: 150,
  speedMax: 330,
  /** Pixels per second gained each second. */
  ramp: 7,
  /** Distance between geese. The minimum is set by the jump: at top speed
   *  the arc covers ~200px, and you need room to land and take off again. */
  gapMin: 260,
  gapMax: 520,
  /** Seconds per running frame. */
  strideTime: 0.12,
  /** Pixels of distance per point. */
  pointEvery: 12,
  /** Longest step the simulation will take. A tab coming back from the
   *  background hands over a huge dt, and a goose should not pass through
   *  the character inside it. */
  maxStep: 0.05,
} as const;

/** How close the character gets before a goose raises its wings. */
export const ALERT_RANGE = 86;

/** Character hitbox inset, so grazing a goose's outline is not a loss. */
const HIT_INSET_X = 5;
/** How far the character may sink into a goose's height before it counts. */
const HIT_GRACE_Y = 3;

/** Whether the character, at `lift`, overlaps any goose. */
export function collides(state: GameState, options: GameOptions): boolean {
  const { character, goose } = options;
  const left = character.x + HIT_INSET_X;
  const right = character.x + character.width - HIT_INSET_X;
  if (state.lift >= goose.height - HIT_GRACE_Y) return false;
  for (const g of state.geese) {
    const gLeft = g.x + 2;
    const gRight = g.x + goose.width - 2;
    if (right > gLeft && left < gRight) return true;
  }
  return false;
}

export function createGame(options: GameOptions): Game {
  const rand = mulberry32(options.seed ?? 0x60053);

  const fresh = (): GameState => ({
    time: 0,
    speed: PHYSICS.speed0,
    distance: 0,
    lift: 0,
    vy: 0,
    grounded: true,
    geese: [],
    // A little grace before the first goose.
    nextSpawnAt: options.width * 0.9,
    over: false,
    score: 0,
  });

  let state = fresh();

  const gap = (): number => PHYSICS.gapMin + rand() * (PHYSICS.gapMax - PHYSICS.gapMin);

  function advance(dt: number): void {
    state.time += dt;
    state.speed = Math.min(PHYSICS.speedMax, state.speed + PHYSICS.ramp * dt);
    const moved = state.speed * dt;
    state.distance += moved;
    state.score = Math.floor(state.distance / PHYSICS.pointEvery);

    // The character.
    if (!state.grounded) {
      state.vy -= PHYSICS.gravity * dt;
      state.lift += state.vy * dt;
      if (state.lift <= 0) {
        state.lift = 0;
        state.vy = 0;
        state.grounded = true;
      }
    }

    // The geese.
    const nose = options.character.x + options.character.width;
    for (const g of state.geese) {
      g.x -= moved;
      // Geese only ever move left, so once one is in range it stays riled —
      // a goose does not calm down because you got past it.
      g.alert = g.alert || g.x < nose + ALERT_RANGE;
    }
    state.geese = state.geese.filter((g) => g.x + options.goose.width > -4);
    if (state.distance >= state.nextSpawnAt) {
      state.geese.push({ x: options.width + 8, alert: false });
      state.nextSpawnAt = state.distance + gap();
    }

    if (collides(state, options)) state.over = true;
  }

  return {
    get state(): GameState {
      return state;
    },

    get pose(): CharacterPose {
      if (state.over) return "stand";
      if (!state.grounded) return "jump";
      return Math.floor(state.time / PHYSICS.strideTime) % 2 === 0 ? "run0" : "run1";
    },

    jump(): void {
      if (state.over || !state.grounded) return;
      state.grounded = false;
      state.vy = PHYSICS.jumpSpeed;
    },

    step(dt: number): void {
      if (state.over || dt <= 0) return;
      // Sub-step long frames so nothing tunnels.
      let remaining = dt;
      while (remaining > 0 && !state.over) {
        const slice = Math.min(PHYSICS.maxStep, remaining);
        advance(slice);
        remaining -= slice;
      }
    },

    reset(): void {
      state = fresh();
    },
  };
}
