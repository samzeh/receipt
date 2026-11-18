import { CHARACTER_PIXELS } from "./character";

/**
 * Sprites for the game: the character's poses, the goose, and a digit font.
 *
 * The character's poses are derived from the drawn figure rather than drawn
 * separately. The legs split cleanly down a transparent column, so a running
 * frame is the figure with one foot lifted and the jump is both feet tucked —
 * which keeps the poses consistent with the art without hand-editing 70 rows
 * three more times.
 */

export type CharacterPose = "stand" | "run0" | "run1" | "jump";

export const CHARACTER_SIZE = {
  width: CHARACTER_PIXELS[0]!.length,
  height: CHARACTER_PIXELS.length,
} as const;

/**
 * Where the limbs are in the drawing. Found by looking: the legs part at a
 * fully transparent column, and the arms are whatever sits outside the
 * hoodie's run on each side.
 */
const LIMBS = {
  legSplit: 16,
  footTop: 63,
  // Row 54 is the underside outline of the hands. Stopping at 53 left it
  // behind while the hand moved, which reads as a smear under the arm.
  arms: { top: 46, bottom: 55, left: [2, 8], right: [25, 30] },
  /**
   * Pixels inside the arm columns that belong to the shorts, not the hand:
   * on the bottom row the hand and the shorts share an outline. Lifting them
   * took the shorts' edge away with the hand and left the hip open.
   */
  shared: [
    [54, 7],
    [54, 25],
  ],
} as const;

interface Region {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * Lifts a rectangle of the sprite by `by` rows: clears it where it was, then
 * draws it again higher up.
 *
 * Clearing first matters. Drawing the shifted copy over the original leaves
 * the bottom of the old limb behind, which reads as a second foot.
 */
function lift(rows: readonly string[], region: Region, by: number): string[] {
  const out = rows.map((r) => r.split(""));
  for (let y = region.y0; y < region.y1; y++) {
    for (let x = region.x0; x < region.x1; x++) out[y]![x] = ".";
  }
  for (let y = region.y0; y < region.y1; y++) {
    for (let x = region.x0; x < region.x1; x++) {
      const src = rows[y]?.[x];
      if (src && src !== "." && y - by >= 0) out[y - by]![x] = src;
    }
  }
  // Put back the pixels the hand only borrows. Without this the hip is left
  // without an outline, which shows as a notch beside the shorts.
  for (const [y, x] of LIMBS.shared) {
    if (y >= region.y0 && y < region.y1 && x >= region.x0 && x < region.x1) {
      out[y]![x] = CHARACTER_PIXELS[y]![x]!;
    }
  }
  return out.map((r) => r.join(""));
}

const foot = (side: "left" | "right"): Region => ({
  x0: side === "left" ? 0 : LIMBS.legSplit + 1,
  x1: side === "left" ? LIMBS.legSplit : CHARACTER_SIZE.width,
  y0: LIMBS.footTop,
  y1: CHARACTER_SIZE.height,
});

const arm = (side: "left" | "right"): Region => ({
  x0: LIMBS.arms[side][0],
  x1: LIMBS.arms[side][1],
  y0: LIMBS.arms.top,
  y1: LIMBS.arms.bottom,
});

/**
 * A stride: one foot up and the *opposite* arm up, which is how people
 * actually run. Moving the feet alone reads as a shuffle.
 */
function stride(side: "left" | "right", by: number): string[] {
  const other = side === "left" ? "right" : "left";
  return lift(lift(CHARACTER_PIXELS, foot(side), by), arm(other), by);
}

const FRAMES: Record<CharacterPose, readonly string[]> = {
  stand: CHARACTER_PIXELS,
  run0: stride("left", 2),
  run1: stride("right", 2),
  // Both feet tucked and both arms up: the shape of someone mid-leap.
  jump: lift(
    lift(lift(lift(CHARACTER_PIXELS, foot("left"), 3), foot("right"), 3), arm("left"), 3),
    arm("right"),
    3,
  ),
};

export function characterFrame(pose: CharacterPose): readonly string[] {
  return FRAMES[pose];
}

/**
 * A Canada goose, facing left, since it comes at you from the right.
 *
 * Narrow and upright: a standing goose is a tall bird on a small footprint,
 * and a wide one reads as a duck. The width is also the hitbox, so this is a
 * gameplay number as much as a drawing one.
 *
 * . transparent  K outline  N black neck, head and legs  B bill  W chin strap
 * D dark brown  L brown  P pale breast
 */
export const GOOSE_PIXELS: readonly string[] = [
  "...KKK.........",
  "..KNNNK........",
  "BBNWNNK........",
  "..KWNNK........",
  "...KNNK........",
  "...KNNK........",
  "...KNNK........",
  "...KNNK........",
  "...KNNK........",
  "...KNNKK.......",
  "..KNNNDDK......",
  "..KNDDDDDK.....",
  ".KDDDDDDDDK....",
  ".KDDDDDDDDDK...",
  "KDDDDDDDDDDDK..",
  "KPDDDDDDDDDDDK.",
  "KPPPDDDDDDDDLK.",
  ".KPPPPPPPDDDLK.",
  "..KPPPPPPPPDK..",
  "...KKPPPPKK....",
  "....KNK.KNK....",
  "....KNK.KNK....",
  "...KNNK.KNNK...",
  "..KNNNK.KNNNK..",
];

export const GOOSE_PALETTE: Record<string, string> = {
  K: "#14110e",
  N: "#1e1e1e",
  B: "#45454a",
  W: "#f2f2f2",
  D: "#6b4f33",
  L: "#8f6f4a",
  P: "#c9b291",
};

export const GOOSE_SIZE = {
  width: GOOSE_PIXELS[0]!.length,
  height: GOOSE_PIXELS.length,
} as const;

/**
 * The same bird with one wing thrown up — the posture a Canada goose takes
 * when it has decided you are the problem.
 *
 * Built from the calm sprite rather than drawn again, so the head, neck and
 * chin strap stay exactly as legible as they are standing. One wing, not two:
 * a bird seen side-on shows the near wing, and a symmetric pair reads as
 * horns rather than as feathers.
 *
 * Drawn bottom-aligned so the wing rises above the body. The hitbox
 * deliberately stays the calm size: a goose that grew as you approached would
 * be unfair, because by then you have already committed to the jump.
 */
export const GOOSE_ALERT_PIXELS: readonly string[] = [
  "...................K....",
  "..................KKK...",
  "..................KDDK..",
  ".................KDDDK..",
  ".................KDDDDK.",
  "................KDDDDDK.",
  "................KDDDDDK.",
  "...............KDDDDDDK.",
  "...............KLLLLLLK.",
  "....KKKK.......KLLLLLK..",
  "...KNNNNK.....KLLLLLLK..",
  "..KBNNNNK.....KLLLLLLK..",
  "KBBBNNNNK.....KLLLLLK...",
  "..KKKWWK......KLLLLLK...",
  ".....KWWK.....KLLLLK....",
  "......KNNKNNDDKKLLLK....",
  ".......KNNKDDDDKLLK.....",
  ".......KKNNKDDDDKLK.....",
  ".......KDDDDDDDDDK......",
  "......KDDDDDDDDDDDK.....",
  "......KPDDDDDDDDDDDK....",
  "......KPPPDDDDDDDDLK....",
  ".......KPPPPPPPDDDLK....",
  "........KPPPPPPPPDK.....",
  ".........KKPPPPKK.......",
  "..........KNK.KNK.......",
  "..........KNK.KNK.......",
  ".........KNNK.KNNK......",
  "........KNNNK.KNNNK.....",
];

export const GOOSE_ALERT_SIZE = {
  width: GOOSE_ALERT_PIXELS[0]!.length,
  height: GOOSE_ALERT_PIXELS.length,
} as const;

/** The frame to draw for a goose, calm or raised. */
export function gooseFrame(alert: boolean): readonly string[] {
  return alert ? GOOSE_ALERT_PIXELS : GOOSE_PIXELS;
}

/**
 * 3 x 5 uppercase letters, for the lose screen. Crude, but at this size
 * every pixel font is; what matters is that each glyph is distinct.
 */
export const LETTERS: Record<string, readonly string[]> = {
  A: ["###", "#.#", "###", "#.#", "#.#"],
  B: ["##.", "#.#", "##.", "#.#", "##."],
  C: ["###", "#..", "#..", "#..", "###"],
  D: ["##.", "#.#", "#.#", "#.#", "##."],
  E: ["###", "#..", "##.", "#..", "###"],
  F: ["###", "#..", "##.", "#..", "#.."],
  G: ["###", "#..", "#.#", "#.#", "###"],
  H: ["#.#", "#.#", "###", "#.#", "#.#"],
  I: ["###", ".#.", ".#.", ".#.", "###"],
  J: ["..#", "..#", "..#", "#.#", "###"],
  K: ["#.#", "#.#", "##.", "#.#", "#.#"],
  L: ["#..", "#..", "#..", "#..", "###"],
  M: ["#.#", "###", "###", "#.#", "#.#"],
  N: ["##.", "#.#", "#.#", "#.#", "#.#"],
  O: ["###", "#.#", "#.#", "#.#", "###"],
  P: ["###", "#.#", "###", "#..", "#.."],
  Q: ["###", "#.#", "#.#", "###", "..#"],
  R: ["###", "#.#", "##.", "#.#", "#.#"],
  S: ["###", "#..", "###", "..#", "###"],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
  U: ["#.#", "#.#", "#.#", "#.#", "###"],
  V: ["#.#", "#.#", "#.#", "#.#", ".#."],
  W: ["#.#", "#.#", "###", "###", "#.#"],
  X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
  Y: ["#.#", "#.#", ".#.", ".#.", ".#."],
  Z: ["###", "..#", ".#.", "#..", "###"],
  ".": ["...", "...", "...", "...", ".#."],
  "-": ["...", "...", "###", "...", "..."],
};

/** The glyph for a character, or null for anything the font lacks. */
export function glyph(ch: string): readonly string[] | null {
  if (ch >= "0" && ch <= "9") return DIGITS[Number(ch)]!;
  return LETTERS[ch.toUpperCase()] ?? null;
}

/** 3 x 5 digits, for the score. */
export const DIGITS: readonly (readonly string[])[] = [
  ["###", "#.#", "#.#", "#.#", "###"],
  [".#.", "##.", ".#.", ".#.", "###"],
  ["###", "..#", "###", "#..", "###"],
  ["###", "..#", "###", "..#", "###"],
  ["#.#", "#.#", "###", "..#", "..#"],
  ["###", "#..", "###", "..#", "###"],
  ["###", "#..", "###", "#.#", "###"],
  ["###", "..#", "..#", "..#", "..#"],
  ["###", "#.#", "###", "#.#", "###"],
  ["###", "#.#", "###", "..#", "###"],
];
