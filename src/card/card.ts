import {
  BufferAttribute, type BufferGeometry, CanvasTexture, DataTexture, ExtrudeGeometry, Group,
  LinearFilter, LinearMipmapLinearFilter, NearestFilter, PlaneGeometry, ShapeGeometry,
  type Material, Mesh, MeshPhysicalMaterial, RepeatWrapping, RGBAFormat, Shape,
  SRGBColorSpace, type Texture, Vector2, Vector3,
} from "three";
import { CHARACTER_PALETTE } from "./character";
import type { Sticker } from "./sticker";
import {
  CHARACTER_SIZE, type CharacterPose, characterFrame, glyph, GOOSE_PALETTE, gooseFrame,
} from "./sprites";

/** The colour the name is printed in. */
export const NAME_INK = "#c6ea99";

/**
 * The name, rendered with a real typeface.
 *
 * Deliberately not the 3 x 5 pixel font: the landscape is pixel art because
 * it is a drawing, but a name is typography, and a nine-character word at
 * three pixels a letter is a smudge. Drawn large and minified, so the letters
 * stay smooth while everything around them stays blocky.
 */
export function makeNameTexture(
  name: string,
  ink: string = NAME_INK,
): { texture: Texture; aspect: number } | null {
  if (typeof document === "undefined") return null;
  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) return null;

  const size = 72;
  // Semibold rather than bold: at this size a heavy weight closes up the
  // counters and the name turns into a bar.
  const font = `600 ${size}px ui-sans-serif, system-ui, -apple-system, Helvetica, Arial, sans-serif`;
  probe.font = font;
  // Barely any tracking. Caps set tight read as a unit; spaced out they read
  // as separate letters.
  const tracking = size * 0.012;
  const width = Math.ceil(probe.measureText(name).width + tracking * (name.length - 1));

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width + size * 0.3);
  canvas.height = Math.round(size * 1.35);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.fillStyle = ink;
  let x = size * 0.15;
  for (const ch of name) {
    ctx.fillText(ch, x, canvas.height / 2);
    x += ctx.measureText(ch).width + tracking;
  }

  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return { texture: t, aspect: canvas.width / canvas.height };
}
import { mulberry32 } from "../text/rng";

/**
 * A blank metal payment card.
 *
 * ISO/IEC 7810 ID-1, which is the same 85.6 x 53.98mm rectangle every card in
 * your wallet is. Metres throughout, like the rest of the project. The card
 * lies in the XY plane with its face toward +z, so it reads correctly when
 * held up to the camera; a parent transform lays it flat for insertion.
 *
 * No branding, no embossing, no stripe: the base card and its chip only.
 */
export const CARD = {
  width: 0.0856,
  height: 0.05398,
  /** Metal cards run thicker than the 0.76mm of a plastic one. */
  thickness: 0.0008,
  cornerRadius: 0.00318,

  /** EMV contact plate — nearly square, as on a modern card. */
  chipWidth: 0.0122,
  chipHeight: 0.011,
  chipRadius: 0.0013,
  /** Measured from the card's centre: right of centre, a little below the
   *  midline. */
  chipX: 0.027,
  chipY: -0.00689,
  /** Chips stand very slightly proud of the card face. */
  chipProud: 0.00004,

  /**
   * Printed name, low and to the right of the character.
   *
   * Its height follows from its width, and under the character's feet there
   * is only about 5.6mm of grass — not enough for a name this size. Clear of
   * the character's columns there is nothing above it, so it can sit as high
   * as it likes.
   */
  name: "SAMUEL H.",
  nameWidth: 0.03,
  nameX: -0.0246,
  nameY: -0.02079,
} as const;

/**
 * How far the printed faces sit inside the card's outline. Must clear the
 * edge roundover of the substrate beneath them, or the faces overhang it.
 */
const FACE_INSET = 0.00016;

export interface CardAnchors {
  /** Centre of the contact plate, on the card's front face. */
  chip: Vector3;
  /** Outward normal of the face carrying the chip. */
  face: Vector3;
  /** Leading edge when the card is pushed into a slot, chip first. */
  insertEdge: Vector3;
}

export interface Card {
  group: Group;
  anchors: CardAnchors;
  /**
   * Cross-fades between the display face and the playfield: 0 is the card you
   * look at, 1 is the card you play on. The chip fades out as it goes.
   */
  setGameMix(t: number): void;
  /** Draws one frame of the game onto the playfield layout. */
  renderGame(scene: FaceScene): void;
  /**
   * Sticks something to the back of the card. Coordinates are as seen
   * looking at the back, so x runs left to right from that side.
   */
  addSticker(sticker: Sticker, x: number, y: number): void;
  dispose(): void;
}

/** A rectangle with properly rounded corners, centred on the origin. */
function roundedRect(w: number, h: number, r: number): Shape {
  const x = w / 2;
  const y = h / 2;
  const radius = Math.min(r, x, y);
  const s = new Shape();
  s.moveTo(-x + radius, -y);
  s.lineTo(x - radius, -y);
  s.absarc(x - radius, -y + radius, radius, -Math.PI / 2, 0, false);
  s.lineTo(x, y - radius);
  s.absarc(x - radius, y - radius, radius, 0, Math.PI / 2, false);
  s.lineTo(-x + radius, y);
  s.absarc(-x + radius, y - radius, radius, Math.PI / 2, Math.PI, false);
  s.lineTo(-x, -y + radius);
  s.absarc(-x + radius, -y + radius, radius, Math.PI, (3 * Math.PI) / 2, false);
  s.closePath();
  return s;
}

/**
 * Extrudes a rounded rectangle to a given thickness with a small roundover on
 * the edges, centred on the origin and facing +z.
 *
 * The bevel expands the outline, so the plan is drawn inset by it and the
 * bevel grows it back to the stated size.
 */
function plateGeometry(w: number, h: number, r: number, thickness: number): BufferGeometry {
  const bevel = Math.min(0.00012, thickness / 4);
  const g = new ExtrudeGeometry(roundedRect(w - 2 * bevel, h - 2 * bevel, r - bevel), {
    depth: thickness - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 24,
  });
  g.translate(0, 0, -(thickness - 2 * bevel) / 2);
  planarUV(g, w, h);
  return g;
}

/**
 * Remaps UVs to span 0..1 across the plate's face.
 *
 * ExtrudeGeometry's default UVs are in world units, so over a 12mm chip they
 * span 0 to 0.012 and every sample lands in one corner of the texture — the
 * chip comes out flat gold and the brushed metal comes out smooth. Nothing
 * errors; the maps simply never appear.
 */
function planarUV(g: BufferGeometry, w: number, h: number): void {
  const position = g.getAttribute("position");
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    uv[i * 2] = position.getX(i) / w + 0.5;
    uv[i * 2 + 1] = position.getY(i) / h + 0.5;
  }
  g.setAttribute("uv", new BufferAttribute(uv, 2));
}

export interface HorizonBand {
  /** Where the band's top sits, as a fraction of height. */
  base: number;
  /** How far it climbs toward the edges of the card. */
  rise: number;
  /** Minimum width of a flat run, in pixels. Steps are what make it read as
   *  pixel art rather than as a jagged line. */
  step: number;
  /** Random vertical wobble between runs, in pixels. */
  jitter: number;
  seed: number;
}

/**
 * The top edge of one band of hills, as a row index per column.
 *
 * Pure, so the shape of the landscape is testable without a canvas. Heights
 * are held constant across runs of several columns: a per-column curve gives
 * a staircase of single pixels, which reads as a jagged line rather than as
 * blocks.
 */
export function pixelHorizon(cols: number, rows: number, band: HorizonBand): Int32Array {
  const profile = new Int32Array(cols);
  const rand = mulberry32(band.seed);
  let c = 0;
  while (c < cols) {
    const run = band.step + Math.floor(rand() * 3);
    // Valley through the middle, climbing at both edges.
    const t = (c / Math.max(1, cols - 1)) * 2 - 1;
    const wobble = Math.round((rand() - 0.5) * 2 * band.jitter);
    const row = Math.round(rows * (band.base - band.rise * t * t)) + wobble;
    const clamped = Math.max(0, Math.min(rows, row));
    for (let i = c; i < Math.min(cols, c + run); i++) profile[i] = clamped;
    c += run;
  }
  return profile;
}

export interface CloudRun {
  x: number;
  y: number;
  width: number;
}

/**
 * Everything about a cloud's silhouette, in one place.
 *
 * These numbers were dialled in by hand against the reference, which is the
 * only way a shape like this gets settled — so change them by looking, not by
 * reasoning about them.
 */
export const CLOUD_LOOK = {
  /**
   * Width of each bar, base first, as a fraction of the cloud's own width.
   *
   * Non-increasing: a bar wider than the one beneath it hangs over open sky.
   * Read as a continuous profile, so it is the curve that matters and not the
   * number of entries.
   */
  shape: [0.83, 0.79, 0.62, 0.49, 0.41, 0.2],
  /**
   * Roughly how many times wider than tall a cloud comes out.
   *
   * Height follows width rather than being fixed, because the two layouts are
   * the same scene at very different sizes: six bars across the game's little
   * nine-block clouds would stack them into pyramids.
   */
  aspect: 3.2,
  /**
   * How symmetrical a cloud is: 1 centres every bar over the base, 0 lets
   * each one sit anywhere the bar below allows.
   *
   * The single biggest lever on how a cloud reads. Centred is the storybook
   * blob; loose is a ragged drift.
   */
  centre: 0.43,
};

/** Kept for the tests and for anyone reading the shape rather than tuning it. */
export const CLOUD_SHAPE: readonly number[] = CLOUD_LOOK.shape;

/** `shape` read as a continuous profile, so it can be resampled to any height. */
function profileAt(shape: readonly number[], t: number): number {
  const p = t * (shape.length - 1);
  const i = Math.floor(p);
  const next = Math.min(shape.length - 1, i + 1);
  return shape[i]! + (shape[next]! - shape[i]!) * (p - i);
}

/**
 * One cloud, as a stack of horizontal runs built up from its base.
 *
 * Each bar is laid inside the span of the bar below it. Choosing every bar's
 * offset independently is what let one poke out over nothing; nesting them
 * makes an overhang impossible rather than unlikely.
 *
 * Built base first, so that a cloud shrinking into the game loses bars off
 * its top while the ones below keep the offsets they already had.
 *
 * Pure, so the shape is testable without a canvas.
 */
export function cloudRuns(width: number, seed: number, shape = CLOUD_LOOK.shape): CloudRun[] {
  const rand = mulberry32(seed);
  const aspect = Math.max(0.5, CLOUD_LOOK.aspect);
  const centre = Math.max(0, Math.min(1, CLOUD_LOOK.centre));
  const rows = Math.max(1, Math.min(shape.length, Math.round(width / aspect)));
  const runs: CloudRun[] = [];
  let lo = 0;
  let hi = width;
  for (let i = 0; i < rows; i++) {
    const fraction = profileAt(shape, rows === 1 ? 0 : i / (rows - 1));
    // Clamped to what the bar below leaves available, so the nesting holds
    // even where the profile does not taper fast enough for a narrow cloud.
    const w = Math.max(2, Math.min(Math.round(width * fraction), hi - lo));
    const slack = Math.max(0, hi - lo - w);
    const loose = slack * rand();
    const x = Math.round(lo + loose + (slack / 2 - loose) * centre);
    runs.push({ x, y: rows - 1 - i, width: w });
    lo = x;
    hi = x + w;
  }
  return runs;
}

/** Sky, and the hills in the order they are painted: highest band first. */
const LANDSCAPE = {
  sky: "#86d0fb",
  bands: [
    // No jitter: a random nudge per run is noise sitting on top of the hill
    // curve, and at these run lengths it steps up and down every few blocks
    // and reads as a saw rather than as terrain. The curve alone gives the
    // shape; the run lengths give it its steps.
    { color: "#80c74a", base: 0.76, rise: 0.11, step: 5, jitter: 0, seed: 0x51a2 },
    { color: "#6fb83c", base: 0.87, rise: 0.07, step: 6, jitter: 0, seed: 0x7c3e },
    { color: "#5aa130", base: 0.94, rise: 0.04, step: 7, jitter: 0, seed: 0x2d91 },
  ] as (HorizonBand & { color: string })[],
} as const;

const CLOUD_BODY = "#f1f6fd";
/** The underside and the ends, a touch bluer than the body. */
const CLOUD_EDGE = "#d7e6f7";

/**
 * How the card's face is laid out.
 *
 * Two of these, and every field between them is interpolated, so going into
 * the game is a move you watch rather than a cut you miss.
 *
 * `block` is deliberately the same in both. A block size part way between two
 * integers lands every edge on a fractional pixel and blurs it, and with the
 * column count fixed the hill profile simply translates as the horizon drops
 * instead of reshuffling into a different set of steps.
 */
export interface FaceLayout {
  /** Pixel size of a landscape block. Shared by both layouts. */
  block: number;
  /** Pixel size of one of the character's pixels. */
  characterScale: number;
  /** Top-left of the character, in texture pixels. */
  characterAt: { x: number; y: number };
  /** Top of each hill band, as a fraction of height. */
  bases: readonly [number, number, number];
  /**
   * How far each band climbs toward the edges, as a fraction of height.
   * Has to shrink with the bands: a climb taller than the strip itself puts
   * hills over the horizon rather than undulations in it.
   */
  rises: readonly [number, number, number];
  /** Clouds, in texture pixels. */
  clouds: readonly { x: number; y: number; width: number; seed: number }[];
}

/** The card at rest: big scene, character front and centre. */
export const DISPLAY_LAYOUT: FaceLayout = {
  block: 6,
  characterScale: 2,
  characterAt: { x: 26, y: 32 },
  bases: [0.76, 0.87, 0.94],
  rises: [0.11, 0.07, 0.04],
  clouds: [
    { x: 0, y: 32, width: 120, seed: 0x3f21 },
    { x: 162, y: 82, width: 96, seed: 0x8ad4 },
    { x: 248, y: 18, width: 72, seed: 0x16bc },
  ],
};

/**
 * The back of the card: the same sky and hills, with the clouds elsewhere.
 *
 * An identical sky on both faces is what gives away that it is one picture
 * printed twice — and with no character to sit behind, the back has the room
 * to put them somewhere else.
 */
export const BACK_LAYOUT: FaceLayout = {
  ...DISPLAY_LAYOUT,
  clouds: [
    { x: 68, y: 18, width: 108, seed: 0x5d08 },
    { x: 198, y: 62, width: 120, seed: 0x2e97 },
    { x: 6, y: 94, width: 66, seed: 0xc4a1 },
  ],
};

/**
 * The card as a playfield: the scene pulls back, the horizon drops to a strip
 * and the sky opens up for things to jump over.
 */
export const GAME_LAYOUT: FaceLayout = {
  block: 6,
  characterScale: 1,
  characterAt: { x: 36, y: 111 },
  bases: [0.93, 0.965, 0.99],
  // Dead flat. A running track with bumps in it reads as the ground moving
  // under you rather than you moving over it, and the character's feet would
  // leave the surface on every rise.
  rises: [0, 0, 0],
  // Smaller than the resting card, because the whole scene pulls back — but
  // only by about a quarter. Taken much further they stop reading as clouds
  // and start reading as specks of dust on the sky.
  //
  // Spread down the sky rather than banked along the top: with the horizon
  // dropped to a strip there is a lot of open blue, and clouds only in the
  // top third leave the middle of the card empty. The lowest still stops well
  // above the geese, which is the part that has to stay readable — the
  // character passing in front of one mid-jump is fine, and is the only thing
  // that shows the sky is moving at all.
  clouds: [
    { x: 16, y: 20, width: 90, seed: 0x3f21 },
    { x: 168, y: 92, width: 72, seed: 0x8ad4 },
    { x: 246, y: 48, width: 60, seed: 0x16bc },
  ],
};

/** Blends two layouts. Every visible quantity moves; nothing cross-fades. */
export function lerpLayout(a: FaceLayout, b: FaceLayout, t: number): FaceLayout {
  const k = Math.max(0, Math.min(1, t));
  const mix = (x: number, y: number): number => x + (y - x) * k;
  return {
    block: a.block,
    characterScale: mix(a.characterScale, b.characterScale),
    characterAt: {
      x: mix(a.characterAt.x, b.characterAt.x),
      y: mix(a.characterAt.y, b.characterAt.y),
    },
    bases: [
      mix(a.bases[0], b.bases[0]),
      mix(a.bases[1], b.bases[1]),
      mix(a.bases[2], b.bases[2]),
    ],
    rises: [
      mix(a.rises[0], b.rises[0]),
      mix(a.rises[1], b.rises[1]),
      mix(a.rises[2], b.rises[2]),
    ],
    clouds: a.clouds.map((cloud, i) => {
      const to = b.clouds[i] ?? cloud;
      return {
        x: mix(cloud.x, to.x),
        y: mix(cloud.y, to.y),
        width: mix(cloud.width, to.width),
        seed: cloud.seed,
      };
    }),
  };
}

/**
 * What the game adds on top of a layout for one frame. Positions are texture
 * pixels; `lift` is height above the ground line, so up is positive.
 */
export interface FaceScene {
  pose: CharacterPose;
  lift: number;
  /** Pixels scrolled so far, for the ground and the clouds. */
  scroll: number;
  /** The geese: left edge, and whether their wings are up. */
  geese: readonly { x: number; alert: boolean }[];
  score: number;
  over: boolean;
  /** Best score so far, shown on the lose screen. */
  best?: number;
}

export interface Face {
  texture: Texture;
  /** Redraws the face at a layout, with the game's frame on top if given.
   *  Cheap enough to run every frame. */
  draw(layout: FaceLayout, scene?: FaceScene): void;
}

export function makeFace(
  withCharacter = true,
  initial: FaceLayout = DISPLAY_LAYOUT,
  cols = 300,
  rows = 192,
): Face | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;

  const paint = (layout: FaceLayout, scene?: FaceScene): void => {

  const unit = layout.block;
  const coarseCols = Math.floor(cols / unit);
  const coarseRows = Math.floor(rows / unit);
  ctx.fillStyle = LANDSCAPE.sky;
  ctx.fillRect(0, 0, cols, rows);

  // Clouds go on before the hills, so a hill would occlude one rather than
  // the other way round.
  for (const cloud of layout.clouds) {
    // Bars are laid out in blocks, then placed in pixels, so a cloud can move
    // and shrink continuously while its bars stay hard-edged. Rounding is
    // what keeps the edges crisp part way through the move.
    const bars = Math.max(2, Math.round(cloud.width / unit));
    const runs = cloudRuns(bars, cloud.seed);
    const px = (v: number): number => Math.round(v);
    // In the game the sky drifts past, slower than the ground.
    const period = cols + cloud.width;
    const drift = scene ? ((((cloud.x - scene.scroll * 0.18) % period) + period) % period) - cloud.width : cloud.x;
    runs.forEach((run, i) => {
      const x = drift + run.x * unit;
      const y = cloud.y + run.y * unit;
      const w = run.width * unit;
      // Runs come back base first, and the base is the shaded underside.
      ctx.fillStyle = i === 0 ? CLOUD_EDGE : CLOUD_BODY;
      ctx.fillRect(px(x), px(y), px(x + w) - px(x), px(y + unit) - px(y));
      // Tint both ends, so each bar has a defined edge instead of stopping.
      ctx.fillStyle = CLOUD_EDGE;
      ctx.fillRect(px(x), px(y), unit, px(y + unit) - px(y));
      ctx.fillRect(px(x + w - unit), px(y), unit, px(y + unit) - px(y));
    });
  }

  let horizon: Int32Array | null = null;
  LANDSCAPE.bands.forEach((band, i) => {
    const profile = pixelHorizon(coarseCols, coarseRows, {
      ...band,
      base: layout.bases[i]!,
      rise: layout.rises[i]!,
    });
    if (i === 0) horizon = profile;
    ctx.fillStyle = band.color;
    for (let x = 0; x < coarseCols; x++) {
      const top = profile[x]!;
      if (top >= coarseRows) continue;
      // Down to the canvas edge rather than to the last whole block: when
      // rows is not a multiple of BLOCK the remainder is left as sky, which
      // shows as a strip of blue under the grass.
      ctx.fillRect(x * unit, top * unit, unit, rows - top * unit);
    }
  });

  // The character last, so it stands in front of the hills.
  /** Draws a string in the pixel font. Returns its width. */
  const text = (
    str: string,
    x: number,
    y: number,
    scale: number,
    colour: string,
  ): number => {
    ctx.fillStyle = colour;
    const advance = 4 * scale;
    let cursor = x;
    for (const ch of str) {
      if (ch === " ") {
        cursor += advance;
        continue;
      }
      const g = glyph(ch);
      if (g) {
        g.forEach((line, gy) => {
          for (let gx = 0; gx < 3; gx++) {
            if (line[gx] === "#") {
              ctx.fillRect(cursor + gx * scale, y + gy * scale, scale, scale);
            }
          }
        });
      }
      cursor += advance;
    }
    return cursor - x;
  };

  const textWidth = (str: string, scale: number): number => str.length * 4 * scale - scale;

  const groundY = layout.characterAt.y + CHARACTER_SIZE.height * layout.characterScale;

  if (scene && horizon) {
    // Marks on the ground that scroll with the run. Without them a flat
    // strip gives no sense of speed at all.
    ctx.fillStyle = "#6aa83a";
    const spacing = 53;
    const marks = Math.ceil(cols / spacing) + 2;
    for (let k = 0; k < marks; k++) {
      const x = ((((k * spacing + (k * 17) % 29) - scene.scroll) % cols) + cols) % cols;
      const col = Math.min(coarseCols - 1, Math.floor(x / unit));
      const top = (horizon[col]! + 1) * unit;
      if (top + unit <= rows) ctx.fillRect(Math.round(x), top, 2 * unit, unit);
    }

    // Geese, standing on the ground line. Bottom-aligned, so the taller
    // alert pose raises its wings rather than sinking its feet.
    for (const g of scene.geese) {
      const sprite = gooseFrame(g.alert);
      sprite.forEach((line, row) => {
        for (let col = 0; col < line.length; col++) {
          const colour = GOOSE_PALETTE[line[col]!];
          if (!colour) continue;
          ctx.fillStyle = colour;
          ctx.fillRect(Math.round(g.x) + col, groundY - sprite.length + row, 1, 1);
        }
      });
    }
  }

  if (withCharacter) {
    const CHARS = "0123456789abcdefghijklmnopqrstuvwxyz";
    const sprite = characterFrame(scene?.pose ?? "stand");
    const liftPx = scene ? Math.round(scene.lift) : 0;
    sprite.forEach((line, row) => {
      for (let col = 0; col < line.length; col++) {
        const colour = CHARACTER_PALETTE[CHARS.indexOf(line[col]!)];
        if (!colour) continue;
        ctx.fillStyle = colour;
        // Each pixel's bounds are rounded independently, so neighbours stay
        // flush at any scale and the sprite shrinks in whole-pixel steps
        // rather than going soft.
        const k = layout.characterScale;
        const x0 = Math.round(layout.characterAt.x + col * k);
        const x1 = Math.round(layout.characterAt.x + (col + 1) * k);
        const y0 = Math.round(layout.characterAt.y + row * k) - liftPx;
        const y1 = Math.round(layout.characterAt.y + (row + 1) * k) - liftPx;
        ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
      }
    });
  }


    if (scene) {
      // Score, top right.
      const score = String(scene.score);
      text(score, cols - 8 - textWidth(score, 2), 7, 2, "#2b3a4a");

      if (scene.over) {
        // A panel rather than text straight on the sky: the landscape runs
        // underneath it and letters this small vanish against the hills.
        const lines: [string, number, string][] = [
          ["GOOSED", 4, "#b93939"],
          [`SCORE ${scene.score}`, 2, "#2b3a4a"],
          [scene.best === undefined ? "" : `BEST ${scene.best}`, 2, "#5f6b78"],
          ["SPACE TO PLAY AGAIN", 2, "#2b3a4a"],
        ];
        const shown = lines.filter(([str]) => str.length > 0);
        const gap = 7;
        const height = shown.reduce((h, [, sc]) => h + 5 * sc + gap, -gap);
        const widest = Math.max(...shown.map(([str, sc]) => textWidth(str, sc)));
        const padX = 14;
        const padY = 11;
        const boxW = widest + padX * 2;
        const boxH = height + padY * 2;
        const boxX = Math.round((cols - boxW) / 2);
        const boxY = Math.round((rows - boxH) / 2) - 8;

        ctx.fillStyle = "rgba(20,28,38,0.22)";
        ctx.fillRect(boxX + 3, boxY + 4, boxW, boxH);
        ctx.fillStyle = "#f4f7fb";
        ctx.fillRect(boxX, boxY, boxW, boxH);
        ctx.fillStyle = "#2b3a4a";
        ctx.fillRect(boxX, boxY, boxW, 2);
        ctx.fillRect(boxX, boxY + boxH - 2, boxW, 2);
        ctx.fillRect(boxX, boxY, 2, boxH);
        ctx.fillRect(boxX + boxW - 2, boxY, 2, boxH);

        let y = boxY + padY;
        for (const [str, sc, colour] of shown) {
          text(str, boxX + Math.round((boxW - textWidth(str, sc)) / 2), y, sc, colour);
          y += 5 * sc + gap;
        }
      }
    }
  };

  paint(initial);

  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  // Hard pixels on magnification; mipmaps still handle minification, so the
  // card does not shimmer when it is small or steeply tilted.
  map.magFilter = NearestFilter;
  map.minFilter = LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = 4;
  map.needsUpdate = true;

  return {
    texture: map,
    draw(layout: FaceLayout, scene?: FaceScene): void {
      paint(layout, scene);
      map.needsUpdate = true;
    },
  };
}

/**
 * Smooth, tileable value noise in 0..1.
 *
 * Tileable matters: these maps repeat across the card, and a lattice that
 * does not wrap puts a visible seam down it. Pure, so the shape of the noise
 * can be checked without a canvas.
 */
export function valueNoise(size: number, cells: number, seed: number): Float32Array {
  const rand = mulberry32(seed);
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();

  // Wrapping the lookup is what makes it tile.
  const at = (cx: number, cy: number): number =>
    lattice[(((cy % cells) + cells) % cells) * cells + (((cx % cells) + cells) % cells)]!;
  const smooth = (t: number): number => t * t * (3 - 2 * t);

  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const fy = (y / size) * cells;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = smooth(fx - x0);
      const ty = smooth(fy - y0);
      const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
      const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
      out[y * size + x] = top * (1 - ty) + bottom * ty;
    }
  }
  return out;
}

/**
 * The card's printed tooth, as a normal map.
 *
 * Two octaves of noise turned into a height field, then differenced into
 * normals. A card is not a mirror and it is not sandpaper: the grain has to
 * be fine enough that you read it as surface rather than as bumps, which is
 * why the fine octave carries most of the amplitude.
 */
export function makeCardGrain(size = 512): DataTexture {
  const fine = valueNoise(size, 96, 0x9c41);
  const broad = valueNoise(size, 18, 0x3ad7);
  const height = new Float32Array(size * size);
  for (let i = 0; i < height.length; i++) height[i] = fine[i]! * 0.7 + broad[i]! * 0.3;

  const at = (x: number, y: number): number =>
    height[(((y % size) + size) % size) * size + (((x % size) + size) % size)]!;

  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = at(x + 1, y) - at(x - 1, y);
      const dy = at(x, y + 1) - at(x, y - 1);
      const i = (y * size + x) * 4;
      data[i] = Math.max(0, Math.min(255, Math.round(128 - dx * 320)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(128 - dy * 320)));
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
  }

  const t = new DataTexture(data, size, size, RGBAFormat);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  // Fine enough that a texel lands well inside a tenth of a millimetre.
  t.repeat.set(5, 3);
  t.needsUpdate = true;
  return t;
}

/**
 * Broad variation in how rough the surface is, from handling.
 *
 * Uniform roughness is the strongest tell that a surface was computed: real
 * light never falls evenly across a card, because the card is never evenly
 * worn. three multiplies the material's roughness by this map's green
 * channel, so the values sit just under 1.
 */
export function makeCardWear(size = 256): DataTexture {
  const noise = valueNoise(size, 6, 0x5be2);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < noise.length; i++) {
    const v = Math.round((0.84 + noise[i]! * 0.16) * 255);
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const t = new DataTexture(data, size, size, RGBAFormat);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/**
 * Brushed metal, as fine directional scratches.
 *
 * A metal surface with a perfectly smooth normal reflects the environment
 * like a mirror, which reads as chrome rather than as a machined card. The
 * streaks are what make the highlight stretch along one axis.
 */
export function makeBrushedNormalMap(size = 512): DataTexture {
  const rand = mulberry32(0x4b2d);
  // One value per row of the texture, so every scratch runs the full width.
  const streak = new Float32Array(size);
  for (let i = 0; i < size; i++) streak[i] = rand() - 0.5;

  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Blend a few neighbouring streaks so scratches vary in width.
      const a = streak[y]!;
      const b = streak[(y + 1) % size]!;
      const c = streak[(y + 7) % size]!;
      const n = (a * 0.6 + b * 0.25 + c * 0.15) * 0.22;
      const i = (y * size + x) * 4;
      data[i] = 128;
      data[i + 1] = Math.max(0, Math.min(255, Math.round((n + 1) * 127.5)));
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
  }

  const t = new DataTexture(data, size, size, RGBAFormat);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}

/**
 * The EMV contact plate's pattern.
 *
 * A plain gold rectangle is the thing that makes a modelled card look fake —
 * a real chip is divided into contacts by etched gaps, with a distinctive
 * notched outline. Drawn rather than modelled, since the gaps are tens of
 * microns deep and only ever read as lines.
 *
 * Returns null without a DOM, so the geometry stays testable in Node.
 */
/**
 * How a point on the contact plate behaves, from how bright its ink is.
 *
 * The pads are polished plating and the gaps between them are etched away —
 * they are not the same material, and the gaps expose substrate. Giving both
 * the same reflection is what makes a chip read as one flat sheet with a
 * pattern painted on it.
 *
 * Pure, so the separation can be checked without a canvas.
 */
export function surfaceFromInk(luminance: number): { roughness: number; metalness: number } {
  const etched = 255 - luminance;
  // Smoothed across the boundary: a hard threshold puts a jagged edge
  // wherever the two materials meet.
  const t = Math.max(0, Math.min(1, (etched - 50) / 32));
  const blend = t * t * (3 - 2 * t);
  return {
    roughness: 0.16 + blend * 0.74,
    metalness: 1 - blend * 0.88,
  };
}

export function makeChipMaps(
  w = 512,
  h = 462,
): { map: Texture; surface: Texture } | null {
  if (typeof document === "undefined") return null;

  const make = (): CanvasRenderingContext2D | null => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    return canvas.getContext("2d");
  };
  const ctx = make();
  const maskCtx = make();
  if (!ctx || !maskCtx) return null;

  /** Rounded rectangle as a path, since roundRect is not everywhere. */
  const roundedPath = (
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    rw: number,
    rh: number,
    r: number,
  ): void => {
    const rad = Math.min(r, rw / 2, rh / 2);
    c.beginPath();
    c.moveTo(x + rad, y);
    c.arcTo(x + rw, y, x + rw, y + rh, rad);
    c.arcTo(x + rw, y + rh, x, y + rh, rad);
    c.arcTo(x, y + rh, x, y, rad);
    c.arcTo(x, y, x + rw, y, rad);
    c.closePath();
  };

  // Brushed silver, lit from the upper left.
  // Bright, because for a metal the base colour IS its reflectance: silver
  // reflects about 95%, so a mid-grey plate reads as painted, not plated.
  const base = ctx.createLinearGradient(0, 0, w * 0.4, h);
  base.addColorStop(0, "#e9ebee");
  base.addColorStop(0.45, "#c9cdd2");
  base.addColorStop(0.75, "#dde0e4");
  base.addColorStop(1, "#b7bbc1");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  // The mask is flat white — no gradient. Shading belongs to the colour, not
  // to which material a point is: reading the surface back out of a shaded
  // image made the dark end of the gradient look exactly like an etched gap,
  // and the bottom of the plate stopped reflecting.
  maskCtx.fillStyle = "#ffffff";
  maskCtx.fillRect(0, 0, w, h);

  // The fine mesh across the plate. Barely visible up close and entirely
  // responsible for it not looking like flat paint. Colour only: it is
  // texture, not a different material.
  ctx.strokeStyle = "rgba(122,127,134,0.16)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= w; x += 7) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, h);
  }
  for (let y = 0; y <= h; y += 7) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(w, y + 0.5);
  }
  ctx.stroke();

  const left = w * 0.3;
  const right = w * 0.7;
  const top = h * 0.07;
  const bottom = h * 0.93;

  /** Everything that is etched away, drawn into both canvases at once. */
  const etched = (c: CanvasRenderingContext2D, ink: string, rim: string): void => {
    // A groove in bright plating is only a little darker than the plating
    // around it; pushing it dark turns the chip into a line drawing.
    c.strokeStyle = ink;
    c.lineWidth = Math.round(w * 0.014);
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(left, top);
    c.lineTo(left, bottom);
    c.moveTo(right, top);
    c.lineTo(right, bottom);
    for (const y of [h * 0.36, h * 0.64]) {
      c.moveTo(w * 0.06, y);
      c.lineTo(left, y);
      c.moveTo(right, y);
      c.lineTo(w * 0.94, y);
    }
    // Angled cuts at the bottom corners.
    c.moveTo(w * 0.06, h * 0.84);
    c.lineTo(w * 0.15, h * 0.945);
    c.moveTo(w * 0.94, h * 0.84);
    c.lineTo(w * 0.85, h * 0.945);
    c.stroke();

    // The waisted central island: wide through the middle, pinched top and
    // bottom. It is the shape that makes a chip read as a chip.
    c.beginPath();
    c.moveTo(w * 0.43, top + h * 0.06);
    c.bezierCurveTo(w * 0.355, h * 0.26, w * 0.355, h * 0.74, w * 0.43, bottom - h * 0.06);
    c.lineTo(w * 0.57, bottom - h * 0.06);
    c.bezierCurveTo(w * 0.645, h * 0.74, w * 0.645, h * 0.26, w * 0.57, top + h * 0.06);
    c.closePath();
    c.stroke();

    // A soft rim, so the plate reads as set into the card.
    c.strokeStyle = rim;
    c.lineWidth = Math.round(w * 0.018);
    roundedPath(c, c.lineWidth / 2, c.lineWidth / 2, w - c.lineWidth, h - c.lineWidth, w * 0.11);
    c.stroke();
  };

  etched(ctx, "#a3a9b1", "rgba(166,172,180,0.6)");
  etched(maskCtx, "#000000", "rgba(0,0,0,0.75)");

  // Bond-wire dots, colour only: they are a mark on a pad, not a cut into it.
  ctx.fillStyle = "rgba(164,170,178,0.75)";
  const dots: [number, number][] = [
    [0.18, 0.5],
    [0.82, 0.5],
    [0.18, 0.78],
    [0.82, 0.22],
  ];
  for (const [dx, dy] of dots) {
    ctx.beginPath();
    ctx.arc(w * dx, h * dy, w * 0.011, 0, Math.PI * 2);
    ctx.fill();
  }

  const map = new CanvasTexture(ctx.canvas);
  map.colorSpace = SRGBColorSpace;
  map.needsUpdate = true;

  // One map carrying both properties: three takes roughness from the green
  // channel and metalness from the blue, so the pads come out polished metal
  // and the gaps matte substrate.
  const image = maskCtx.getImageData(0, 0, w, h);
  const pixels = image.data;
  for (let i = 0; i < pixels.length; i += 4) {
    const { roughness, metalness } = surfaceFromInk(pixels[i]!);
    pixels[i] = 0;
    pixels[i + 1] = Math.round(roughness * 255);
    pixels[i + 2] = Math.round(metalness * 255);
    pixels[i + 3] = 255;
  }
  maskCtx.putImageData(image, 0, 0);

  const surface = new CanvasTexture(maskCtx.canvas);
  surface.needsUpdate = true;

  return { map, surface };
}

export function createCard(): Card {
  const group = new Group();
  group.name = "card";

  // A printed card under lacquer, not bare metal. On a metal a colour map is
  // reflectance tint, so artwork would render as tinted chrome rather than as
  // print; the ink has to sit on a dielectric. The clearcoat is the laminate,
  // and it is what keeps the chip reading as the one metal thing on the card.
  // Matte print, deliberately unlacquered.
  const grain = makeCardGrain();
  const wear = makeCardWear();
  const printed = (map: Texture | null, fallback: number): MeshPhysicalMaterial =>
    new MeshPhysicalMaterial({
      color: map ? 0xffffff : fallback,
      map,
      metalness: 0,
      roughness: 0.74,
      // Roughness varies across the card, so light falls on it unevenly.
      // A single value everywhere is what made it read as a flat panel.
      roughnessMap: wear,
      // Printed tooth. Enough to catch a grazing light, held back from the
      // point where it starts smearing the pixel edges.
      normalMap: grain,
      normalScale: new Vector2(0.22, 0.22),
      // Paper scatters at glancing angles; this is what gives an edge its
      // soft falloff rather than a hard terminator.
      sheen: 0.18,
      sheenRoughness: 0.85,
      sheenColor: 0xbfc8b4,
      clearcoat: 0,
      envMapIntensity: 0.62,
    });

  // The front is redrawn as the layout moves; the back never changes.
  const face = makeFace(true);
  const backFace = makeFace(false, BACK_LAYOUT);

  // The substrate carries the front artwork too, so the card's edge is
  // printed rather than a dark rim. planarUV puts the side walls on the
  // texture's perimeter, so the edge is sky along the top and grass along the
  // bottom on its own — which is what an edge-printed card looks like.
  const bodyMat = printed(face?.texture ?? null, 0x2c2f34);

  const body = new Mesh(
    plateGeometry(CARD.width, CARD.height, CARD.cornerRadius, CARD.thickness),
    bodyMat,
  );
  body.name = "body";
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Front and back are separate meshes. An extruded plate puts both caps in
  // one geometry group, so a single mesh cannot carry different art on each
  // side — which is why the back was showing the front's design.
  const frontMat = printed(face?.texture ?? null, 0x2c2f34);
  const backMat = printed(backFace?.texture ?? null, 0x232830);

  // Inset past the substrate's edge roundover. The extruded plate's cap is
  // narrower than its full width — the full width exists only at mid
  // thickness — so a face plate cut to the card's nominal size overhangs the
  // rounded edge, and that lip reads as the artwork wrapping around the side.
  const inset = FACE_INSET;
  const facePlate = (): BufferGeometry => {
    const w = CARD.width - 2 * inset;
    const h = CARD.height - 2 * inset;
    const g = new ShapeGeometry(roundedRect(w, h, CARD.cornerRadius - inset), 24);
    // UVs still span the card's full size, so the art stays registered to the
    // card rather than being scaled up into the inset.
    planarUV(g, w, h);
    return g;
  };

  const LIFT = 1.6e-5;

  const front = new Mesh(facePlate(), frontMat);
  front.name = "front";
  front.position.z = CARD.thickness / 2 + LIFT;
  group.add(front);


  const back = new Mesh(facePlate(), backMat);
  back.name = "back";
  back.position.z = -CARD.thickness / 2 - LIFT;
  back.rotation.y = Math.PI;
  group.add(back);

  const chipMaps = makeChipMaps();
  // Bare plated metal, deliberately a different surface from the card's.
  // The card is coated — it has a clearcoat, which is a dielectric lacquer
  // over the metal. A chip has no lacquer, so dropping the clearcoat is most
  // of what separates the two materials; the rest is being sharper, brighter
  // and letting the map drive roughness across the plate.
  const chipMat = new MeshPhysicalMaterial({
    color: chipMaps ? 0xffffff : 0xdfe2e6,
    map: chipMaps?.map ?? null,
    // One map drives both: green is roughness, blue is metalness. The pads
    // come out polished plating and the etched gaps matte substrate, which
    // they are — giving both the same reflection is what made the plate read
    // as a flat sheet with a pattern painted on it.
    roughnessMap: chipMaps?.surface ?? null,
    metalnessMap: chipMaps?.surface ?? null,
    // These stay as overall dials: the map scales against them, so turning
    // this down still dulls the whole plate.
    metalness: 0.5,
    roughness: chipMaps ? 1 : 0.18,
    clearcoat: 0,
    // Metal reflects nearly all of what hits it, so this multiplies straight
    // into the highlight. Turn this down first if the plate is too bright
    // head on; it scales the reflection without touching the surface.
    envMapIntensity: 0.80,
  });

  const chipThickness = 0.00016;
  const chip = new Mesh(
    plateGeometry(CARD.chipWidth, CARD.chipHeight, CARD.chipRadius, chipThickness),
    chipMat,
  );
  chip.name = "chip";
  chip.position.set(
    CARD.chipX,
    CARD.chipY,
    CARD.thickness / 2 + CARD.chipProud - chipThickness / 2,
  );
  chip.castShadow = true;
  group.add(chip);
  // The chip fades out for the game: it sits in the middle of the playfield,
  // and a contact plate in the way of a running character reads as a bug.
  chipMat.transparent = true;

  // The name, printed. It sits on its own plane only so it can be drawn at a
  // resolution the face texture does not have — the material matches the
  // printed card either side of it, so it reads as ink, not as an overlay.
  const nameMap = makeNameTexture(CARD.name);
  // Tinted foil rather than ink: partly metallic, so the letters take their
  // colour from the map and their brightness from whatever is around them.
  // Not fully metallic — at metalness 1 the colour survives only in the
  // reflection and the name goes dark whenever the card turns away from a
  // light. Holding some diffuse keeps it legible at every angle.
  const nameMat = new MeshPhysicalMaterial({
    color: 0xffffff,
    map: nameMap?.texture ?? null,
    metalness: 0.3,
    roughness: 0.26,
    clearcoat: 0,
    clearcoatRoughness: 0.14,
    transparent: true,
    depthWrite: false,
    envMapIntensity: 1.25,
  });
  const nameHeight = CARD.nameWidth / (nameMap?.aspect ?? 6);
  const nameMesh = new Mesh(new PlaneGeometry(CARD.nameWidth, nameHeight), nameMat);
  nameMesh.name = "name";
  nameMesh.visible = nameMap !== null;
  // Clear of the printed face by more than the face is clear of the
  // substrate, and drawn after everything else: the name is the last thing
  // applied to a card, and nothing on it should ever cross in front.
  nameMesh.position.set(CARD.nameX, CARD.nameY, CARD.thickness / 2 + LIFT * 2);
  nameMesh.renderOrder = 10;
  group.add(nameMesh);

  // Stickers live in their own group, turned to face out of the back. Inside
  // it, x runs the way it does when you are looking at the back — which is
  // the way you think about where a sticker goes.
  const stickers = new Group();
  stickers.name = "stickers";
  stickers.rotation.y = Math.PI;
  stickers.position.z = -(CARD.thickness / 2 + LIFT * 2);
  group.add(stickers);
  const applied: Sticker[] = [];

  const anchors: CardAnchors = {
    chip: new Vector3(CARD.chipX, CARD.chipY, CARD.thickness / 2),
    face: new Vector3(0, 0, 1),
    // Chip first, so whichever short edge the chip sits nearest leads.
    insertEdge: new Vector3(Math.sign(CARD.chipX) * (CARD.width / 2), 0, 0),
  };

  return {
    group,
    anchors,

    setGameMix(t: number): void {
      const mix = Math.max(0, Math.min(1, t));
      // The scene is redrawn at the blended layout, so the horizon, the
      // character and the clouds all visibly travel to their new places.
      face?.draw(lerpLayout(DISPLAY_LAYOUT, GAME_LAYOUT, mix));
      // The chip shrinks away rather than dissolving, for the same reason.
      chip.scale.setScalar(Math.max(0.001, 1 - mix));
      chipMat.opacity = 1 - mix;
      chip.visible = mix < 0.999;
      // The name belongs to the card, not to the game being played on it.
      nameMat.opacity = 1 - mix;
      nameMesh.visible = nameMap !== null && mix < 0.999;
    },

    renderGame(scene: FaceScene): void {
      face?.draw(GAME_LAYOUT, scene);
    },

    addSticker(sticker: Sticker, x: number, y: number): void {
      sticker.mesh.position.set(x, y, 0);
      // Stacked by arrival, so a later sticker sits over an earlier one the
      // way it would if you actually put it there.
      sticker.mesh.renderOrder = 1 + applied.length;
      stickers.add(sticker.mesh);
      applied.push(sticker);
    },

    dispose(): void {
      const geometries = new Set<BufferGeometry>();
      const materials = new Set<Material>();
      group.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        geometries.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
      });
      for (const g of geometries) g.dispose();
      grain.dispose();
      wear.dispose();
      face?.texture.dispose();
      backFace?.texture.dispose();
      nameMap?.texture.dispose();
      for (const sticker of applied) sticker.dispose();
      applied.length = 0;
      chipMaps?.map.dispose();
      chipMaps?.surface.dispose();
      for (const m of materials) m.dispose();
      group.clear();
    },
  };
}
