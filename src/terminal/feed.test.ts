import { describe, expect, it } from "vitest";
import { createFeed } from "./feed";

const SIM_STEP = 1 / 120;

// 10mm rows at 100mm/s is 10 rows per second, so the arithmetic below is easy
// to read: one second of stepping should emit ten rows.
const options = { totalRows: 20, rowSpacing: 0.01, speed: 0.1 };

/** Steps for `seconds` and returns the total rows emitted. */
function run(feed: ReturnType<typeof createFeed>, seconds: number): number {
  let emitted = 0;
  for (let i = 0; i < Math.round(seconds / SIM_STEP); i++) emitted += feed.step(SIM_STEP);
  return emitted;
}

describe("createFeed", () => {
  it("starts idle", () => {
    expect(createFeed(options).phase).toBe("idle");
  });

  it("emits nothing until printing starts", () => {
    const feed = createFeed(options);
    feed.focus();
    feed.arrive();
    expect(run(feed, 1)).toBe(0);
  });

  it("emits rows at the configured speed", () => {
    const feed = createFeed(options);
    feed.focus();
    feed.arrive();
    feed.start();
    expect(run(feed, 1)).toBe(10);
  });

  it("stops at the receipt's length and reports it printed", () => {
    const feed = createFeed(options);
    feed.focus();
    feed.arrive();
    feed.start();
    // Five seconds is far longer than the twenty rows need.
    expect(run(feed, 5)).toBe(options.totalRows);
    expect(feed.phase).toBe("printed");
  });

  it("will not start printing before the camera has arrived", () => {
    const feed = createFeed(options);
    feed.start();
    expect(feed.phase).toBe("idle");
    expect(run(feed, 1)).toBe(0);
  });

  it("moves through focusing on the way to ready", () => {
    const feed = createFeed(options);
    feed.focus();
    expect(feed.phase).toBe("focusing");
    feed.arrive();
    expect(feed.phase).toBe("ready");
  });

  it("reports progress as a fraction of the finished receipt", () => {
    const feed = createFeed(options);
    feed.focus();
    feed.arrive();
    feed.start();
    run(feed, 1);
    expect(feed.progress).toBeCloseTo(0.5, 6);
  });

  it("can only be torn once it has finished printing", () => {
    const feed = createFeed(options);
    feed.focus();
    feed.arrive();
    feed.start();
    feed.tear();
    expect(feed.phase).toBe("printing");

    run(feed, 5);
    feed.tear();
    expect(feed.phase).toBe("torn");
  });

  it("emits nothing more once torn", () => {
    const feed = createFeed(options);
    feed.focus();
    feed.arrive();
    feed.start();
    run(feed, 5);
    feed.tear();
    expect(run(feed, 1)).toBe(0);
  });
});
