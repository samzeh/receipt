import { describe, expect, it } from "vitest";
import { ALERT_RANGE, collides, createGame, type GameOptions, PHYSICS } from "./game";

const options: GameOptions = {
  width: 300,
  character: { x: 36, width: 31, height: 70 },
  goose: { width: 15, height: 24 },
  seed: 1,
};

const DT = 1 / 120;

function run(game: ReturnType<typeof createGame>, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) game.step(DT);
}

describe("createGame", () => {
  it("starts on the ground with nothing to jump over", () => {
    const game = createGame(options);
    expect(game.state.grounded).toBe(true);
    expect(game.state.over).toBe(false);
    expect(game.state.score).toBe(0);
    expect(game.state.geese).toHaveLength(0);
  });

  it("jumps, peaks a few geese high, and comes back down", () => {
    const game = createGame(options);
    game.jump();
    let peak = 0;
    for (let i = 0; i < 120; i++) {
      game.step(DT);
      peak = Math.max(peak, game.state.lift);
    }
    // Clears a goose with room, but not so high the jump feels floaty.
    expect(peak).toBeGreaterThan(options.goose.height + 12);
    expect(peak).toBeLessThan(options.goose.height * 3);
    expect(game.state.grounded).toBe(true);
    expect(game.state.lift).toBe(0);
  });

  it("cannot jump again while in the air", () => {
    const game = createGame(options);
    game.jump();
    run(game, 0.15);
    const vyBefore = game.state.vy;
    game.jump();
    expect(game.state.vy).toBe(vyBefore);
  });

  it("brings geese in from the right and lets them leave on the left", () => {
    const game = createGame(options);
    run(game, 3);
    expect(game.state.geese.length).toBeGreaterThan(0);
    const first = game.state.geese[0]!.x;
    game.step(DT);
    expect(game.state.geese[0]!.x).toBeLessThan(first);
    for (const g of game.state.geese) {
      expect(g.x + options.goose.width).toBeGreaterThan(-4);
    }
  });

  it("never places geese closer together than a jump can cover", () => {
    const game = createGame(options);
    const seen: number[] = [];
    // Collect spawn positions by watching for new geese as they appear.
    let count = 0;
    for (let i = 0; i < 120 * 40; i++) {
      game.step(DT);
      if (game.state.over) {
        game.jump();
        game.reset();
        count = 0;
        continue;
      }
      if (game.state.geese.length > count) {
        seen.push(game.state.distance);
        count = game.state.geese.length;
      }
      count = Math.min(count, game.state.geese.length);
    }
    for (let i = 1; i < seen.length; i++) {
      const gap = seen[i]! - seen[i - 1]!;
      if (gap > 0) expect(gap).toBeGreaterThanOrEqual(PHYSICS.gapMin - 1);
    }
  });

  it("raises a goose's wings only once it is close", () => {
    const game = createGame(options);
    const nose = options.character.x + options.character.width;
    let sawCalm = false;
    for (let i = 0; i < 120 * 8; i++) {
      game.step(DT);
      for (const g of game.state.geese) {
        if (g.x > nose + ALERT_RANGE + 20) {
          expect(g.alert).toBe(false);
          sawCalm = true;
        }
        if (g.x < nose) expect(g.alert).toBe(true);
      }
      if (game.state.over) break;
    }
    expect(sawCalm).toBe(true);
  });

  it("keeps a goose riled once the character has gone by", () => {
    const game = createGame(options);
    const nose = options.character.x + options.character.width;
    let checked = false;
    for (let i = 0; i < 120 * 20; i++) {
      // Held above every goose, so the run is not cut short and geese
      // actually get past. Relying on a jump heuristic here made the test
      // about the heuristic rather than about the geese.
      game.state.lift = 100;
      game.step(DT);
      for (const g of game.state.geese) {
        if (g.x + options.goose.width < nose) {
          expect(g.alert).toBe(true);
          checked = true;
        }
      }
    }
    expect(checked).toBe(true);
  });

  it("ends when a goose reaches the character on the ground", () => {
    const game = createGame(options);
    run(game, 10);
    expect(game.state.over).toBe(true);
  });

  it("holds still once it is over", () => {
    const game = createGame(options);
    run(game, 10);
    const { distance, score } = game.state;
    run(game, 1);
    expect(game.state.distance).toBe(distance);
    expect(game.state.score).toBe(score);
    expect(game.pose).toBe("stand");
  });

  it("speeds up over time, to a limit", () => {
    const game = createGame(options);
    const start = game.state.speed;
    // Keep jumping so it does not end early.
    for (let i = 0; i < 120 * 60; i++) {
      if (game.state.grounded && game.state.geese.some((g) => g.x - 36 < 90 && g.x > 20)) game.jump();
      game.step(DT);
      if (game.state.over) break;
    }
    expect(game.state.speed).toBeGreaterThan(start);
    expect(game.state.speed).toBeLessThanOrEqual(PHYSICS.speedMax);
  });

  it("scores by distance", () => {
    const game = createGame(options);
    run(game, 1);
    expect(game.state.score).toBe(Math.floor(game.state.distance / PHYSICS.pointEvery));
    expect(game.state.score).toBeGreaterThan(0);
  });

  it("alternates running frames and shows the jump pose in the air", () => {
    const game = createGame(options);
    const frames = new Set<string>();
    for (let i = 0; i < 60; i++) {
      game.step(DT);
      frames.add(game.pose);
    }
    expect(frames.has("run0")).toBe(true);
    expect(frames.has("run1")).toBe(true);
    game.jump();
    game.step(DT);
    expect(game.pose).toBe("jump");
  });

  it("resets to a fresh start", () => {
    const game = createGame(options);
    run(game, 10);
    expect(game.state.over).toBe(true);
    game.reset();
    expect(game.state.over).toBe(false);
    expect(game.state.distance).toBe(0);
    expect(game.state.geese).toHaveLength(0);
    expect(game.state.grounded).toBe(true);
  });

  it("does not let a goose pass through the character on a long frame", () => {
    const game = createGame(options);
    // Place a goose just ahead and hand over one huge frame.
    game.state.geese.push({ x: options.character.x + options.character.width + 10, alert: true });
    game.step(2);
    expect(game.state.over).toBe(true);
  });
});

describe("collides", () => {
  const base = () => ({
    time: 0, speed: 0, distance: 0, lift: 0, vy: 0, grounded: true,
    geese: [] as { x: number; alert: boolean }[], nextSpawnAt: 0, over: false, score: 0,
  });

  it("hits a goose standing in the character's path", () => {
    const s = base();
    s.geese = [{ x: options.character.x + 10, alert: true }];
    expect(collides(s, options)).toBe(true);
  });

  it("misses a goose the character has jumped over", () => {
    const s = base();
    s.geese = [{ x: options.character.x + 10, alert: true }];
    s.lift = options.goose.height;
    expect(collides(s, options)).toBe(false);
  });

  it("forgives a graze on the outline", () => {
    const s = base();
    // Goose's left edge just inside the character's right edge, within the inset.
    s.geese = [{ x: options.character.x + options.character.width - 3, alert: true }];
    expect(collides(s, options)).toBe(false);
  });

  it("misses a goose that is still ahead", () => {
    const s = base();
    s.geese = [{ x: options.character.x + options.character.width + 5, alert: false }];
    expect(collides(s, options)).toBe(false);
  });
});
