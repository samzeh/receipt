import { describe, expect, it } from "vitest";
import { CHARACTER_PIXELS } from "./character";
import {
  CHARACTER_SIZE, characterFrame, DIGITS, glyph, GOOSE_ALERT_PIXELS, GOOSE_ALERT_SIZE,
  GOOSE_PALETTE, GOOSE_PIXELS, GOOSE_SIZE, gooseFrame, LETTERS,
} from "./sprites";

const LEG_SPLIT = 16;

describe("characterFrame", () => {
  it("keeps every pose the same size as the drawing", () => {
    for (const pose of ["stand", "run0", "run1", "jump"] as const) {
      const frame = characterFrame(pose);
      expect(frame).toHaveLength(CHARACTER_SIZE.height);
      for (const row of frame) expect(row).toHaveLength(CHARACTER_SIZE.width);
    }
  });

  it("leaves the standing pose as drawn", () => {
    expect(characterFrame("stand")).toEqual(CHARACTER_PIXELS);
  });

  it("lifts the left foot in one running frame and the right in the other", () => {
    const run0 = characterFrame("run0");
    const run1 = characterFrame("run1");
    const bottom = CHARACTER_SIZE.height - 1;

    // Lifted foot: nothing left on the ground on that side.
    expect(run0[bottom]!.slice(0, LEG_SPLIT)).toMatch(/^\.+$/);
    expect(run1[bottom]!.slice(LEG_SPLIT + 1)).toMatch(/^\.+$/);
    // Planted foot: unchanged from the drawing.
    expect(run0[bottom]!.slice(LEG_SPLIT + 1)).toBe(CHARACTER_PIXELS[bottom]!.slice(LEG_SPLIT + 1));
    expect(run1[bottom]!.slice(0, LEG_SPLIT)).toBe(CHARACTER_PIXELS[bottom]!.slice(0, LEG_SPLIT));
  });

  it("makes the two running frames different, so the stride reads", () => {
    expect(characterFrame("run0")).not.toEqual(characterFrame("run1"));
  });

  it("tucks both feet for the jump", () => {
    const jump = characterFrame("jump");
    for (let y = CHARACTER_SIZE.height - 3; y < CHARACTER_SIZE.height; y++) {
      expect(jump[y]).toMatch(/^\.+$/);
    }
    expect(jump).not.toEqual(CHARACTER_PIXELS);
  });

  it("swings the arm opposite the lifted foot", () => {
    // People run with opposite limbs. Moving the feet alone reads as a
    // shuffle, which is what this replaces.
    const run0 = characterFrame("run0");
    const run1 = characterFrame("run1");
    const armRows = [48, 49, 50, 51, 52];

    const leftArm = (f: readonly string[]) => armRows.map((y) => f[y]!.slice(2, 8)).join("");
    const rightArm = (f: readonly string[]) => armRows.map((y) => f[y]!.slice(25, 30)).join("");

    // run0 lifts the left foot, so the right arm moves and the left does not.
    expect(rightArm(run0)).not.toBe(rightArm(CHARACTER_PIXELS));
    expect(leftArm(run0)).toBe(leftArm(CHARACTER_PIXELS));
    // run1 is the mirror.
    expect(leftArm(run1)).not.toBe(leftArm(CHARACTER_PIXELS));
    expect(rightArm(run1)).toBe(rightArm(CHARACTER_PIXELS));
  });

  it("takes the hand's bottom outline with it when the arm moves", () => {
    // Row 54 is the underside of the hands. Leaving it behind while the hand
    // rose smeared an outline under the arm — invisible in a still, obvious
    // once it is running.
    const run0 = characterFrame("run0");
    expect(run0[54]!.slice(26, 30)).toMatch(/^\.*$/);
    expect(run0[54]).not.toBe(CHARACTER_PIXELS[54]);
  });

  it("leaves the shorts their outline when the hand goes up", () => {
    // On the bottom row the hand and the shorts share an outline pixel. It
    // belongs to the shorts: lifting it with the hand opened the hip.
    for (const pose of ["run0", "run1", "jump"] as const) {
      const frame = characterFrame(pose);
      expect(frame[54]![7]).toBe(CHARACTER_PIXELS[54]![7]);
      expect(frame[54]![25]).toBe(CHARACTER_PIXELS[54]![25]);
    }
  });

  it("leaves the head and torso alone in every pose", () => {
    // The arms start at row 46 and the jump lifts them three rows, so row 43
    // is the first that any pose is allowed to touch.
    for (const pose of ["run0", "run1", "jump"] as const) {
      const frame = characterFrame(pose);
      for (let y = 0; y < 43; y++) expect(frame[y]).toBe(CHARACTER_PIXELS[y]);
    }
  });
});

describe("goose", () => {
  it("is rectangular and in palette", () => {
    expect(GOOSE_PIXELS).toHaveLength(GOOSE_SIZE.height);
    for (const row of GOOSE_PIXELS) {
      expect(row).toHaveLength(GOOSE_SIZE.width);
      for (const ch of row) {
        if (ch !== ".") expect(GOOSE_PALETTE[ch]).toBeDefined();
      }
    }
  });

  it("stands on its bottom row and faces left", () => {
    const bottom = GOOSE_PIXELS[GOOSE_SIZE.height - 1]!;
    expect(bottom).toMatch(/N/);
    // The bill reaches the left edge, and sits in the top half: head
    // forward, body behind.
    const billRow = GOOSE_PIXELS.findIndex((r) => r.startsWith("B"));
    expect(billRow).toBeGreaterThanOrEqual(0);
    expect(billRow).toBeLessThan(GOOSE_SIZE.height / 2);
  });

  it("is a Canada goose: black head and neck, white strap, brown body", () => {
    const head = GOOSE_PIXELS.slice(0, 6).join("");
    const body = GOOSE_PIXELS.slice(12, 19).join("");
    expect(head).toMatch(/N/);
    expect(head).toMatch(/W/);
    expect(head).not.toMatch(/[DLP]/);
    expect(body).toMatch(/[DLP]/);
  });

  it("stands tall and narrow, not wide", () => {
    // A wide goose reads as a duck. The width is also the hitbox, so this is
    // a gameplay constraint as much as a drawing one.
    expect(GOOSE_SIZE.height).toBeGreaterThan(GOOSE_SIZE.width * 1.4);
    expect(GOOSE_SIZE.width).toBeLessThanOrEqual(18);
  });

  it("raises a wing above the calm silhouette when alert", () => {
    expect(GOOSE_ALERT_SIZE.height).toBeGreaterThan(GOOSE_SIZE.height);
    expect(gooseFrame(true)).toBe(GOOSE_ALERT_PIXELS);
    expect(gooseFrame(false)).toBe(GOOSE_PIXELS);
    expect(GOOSE_ALERT_PIXELS[0]).toMatch(/K/);
    expect(GOOSE_ALERT_PIXELS.slice(0, 8).join("")).toMatch(/[DL]/);
  });

  it("gives both poses a bill that is visible against the head", () => {
    // The bill used to be drawn in the outline colour, which is black, on a
    // head that is also black — so the goose had no beak at all.
    expect(GOOSE_PALETTE["B"]).toBeDefined();
    expect(GOOSE_PALETTE["B"]).not.toBe(GOOSE_PALETTE["N"]);
    expect(GOOSE_PALETTE["B"]).not.toBe(GOOSE_PALETTE["K"]);
    expect(GOOSE_PIXELS.join("")).toMatch(/B/);
    expect(GOOSE_ALERT_PIXELS.join("")).toMatch(/B/);
  });

  it("puts the alert bill out in front of the head", () => {
    // It has to lead the silhouette, or it reads as part of the skull.
    const billRows = GOOSE_ALERT_PIXELS.map((r, y) => [y, r.indexOf("B")] as const)
      .filter(([, x]) => x >= 0);
    expect(billRows.length).toBeGreaterThan(0);
    for (const [y, x] of billRows) {
      const head = GOOSE_ALERT_PIXELS[y]!.indexOf("N");
      expect(head).toBeGreaterThan(x);
    }
  });

  it("leans the neck forward when alert", () => {
    // Standing, the neck is vertical. Riled, the bird reaches at you — the
    // head should sit ahead of where the body begins.
    const headRow = GOOSE_ALERT_PIXELS[11]!;
    const bodyRow = GOOSE_ALERT_PIXELS[20]!;
    const headLeft = headRow.search(/[^.]/);
    const bodyLeft = bodyRow.search(/[^.]/);
    expect(headLeft).toBeLessThan(bodyLeft);

    // And the neck slopes: each row down, it starts further right.
    const necks = [13, 14, 15, 16, 17].map((y) => GOOSE_ALERT_PIXELS[y]!.search(/[^.]/));
    for (let i = 1; i < necks.length; i++) {
      expect(necks[i]!).toBeGreaterThanOrEqual(necks[i - 1]!);
    }
    expect(necks[necks.length - 1]!).toBeGreaterThan(necks[0]!);
  });

  it("keeps the head and chin strap when the wing goes up", () => {
    // The first attempt drew the alert pose from scratch and lost the head
    // entirely. It is built from the calm sprite now, so the bird stays a
    // bird.
    const head = GOOSE_ALERT_PIXELS.slice(9, 14).join("");
    expect(head).toMatch(/W/);
    expect(head).toMatch(/N/);
  });

  it("joins the wing to the body rather than floating it alongside", () => {
    // A wing that stops short of the shoulder hangs in the air next to the
    // goose, which was exactly what the first version did.
    const solid = (row: string, x0: number, x1: number): boolean =>
      row.slice(x0, x1).split("").some((c) => c !== ".");
    let touching = 0;
    for (let y = 13; y <= 18; y++) {
      const row = GOOSE_ALERT_PIXELS[y]!;
      if (solid(row, 0, 9) && solid(row, 8, 15)) touching += 1;
    }
    expect(touching).toBeGreaterThanOrEqual(3);
  });

  it("keeps the alert pose in the same palette", () => {
    for (const row of GOOSE_ALERT_PIXELS) {
      expect(row).toHaveLength(GOOSE_ALERT_SIZE.width);
      for (const ch of row) {
        if (ch !== ".") expect(GOOSE_PALETTE[ch]).toBeDefined();
      }
    }
  });
});

describe("digits", () => {
  it("has ten glyphs of three by five", () => {
    expect(DIGITS).toHaveLength(10);
    for (const glyph of DIGITS) {
      expect(glyph).toHaveLength(5);
      for (const row of glyph) expect(row).toHaveLength(3);
    }
  });

  it("keeps every digit distinct", () => {
    expect(new Set(DIGITS.map((g) => g.join("/"))).size).toBe(10);
  });
});

describe("letters", () => {
  it("covers the alphabet at three by five", () => {
    for (let c = 65; c <= 90; c++) {
      const g = LETTERS[String.fromCharCode(c)];
      expect(g).toBeDefined();
      expect(g).toHaveLength(5);
      for (const row of g!) expect(row).toHaveLength(3);
    }
  });

  it("keeps every letter distinct", () => {
    const alphabet = Object.entries(LETTERS).filter(([k]) => /^[A-Z]$/.test(k));
    expect(alphabet).toHaveLength(26);
    expect(new Set(alphabet.map(([, g]) => g.join("/"))).size).toBe(26);
  });

  it("carries the punctuation the card needs", () => {
    // Anything drawn with this font loses a character it lacks, silently —
    // no error, just a gap. This regressed once already, when the table was
    // pasted back from a copy that stopped at Z.
    expect(glyph(".")).toBeDefined();
    expect(glyph(".")).not.toBeNull();
  });

  it("looks up digits and letters, and nothing else", () => {
    expect(glyph("7")).toBe(DIGITS[7]);
    expect(glyph("g")).toBe(LETTERS["G"]);
    expect(glyph("!")).toBeNull();
  });
});
