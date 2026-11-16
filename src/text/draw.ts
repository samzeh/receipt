import { MONO_ADVANCE_EM, type ReceiptLayout } from "./layout";
import { mulberry32 } from "./rng";

export const PAPER_RGB = [244, 241, 234] as const;
const INK_RGB = [26, 24, 22] as const;
const MAX_TEXTURE_PX = 4096;

/** The slice of a canvas this module needs, so a Node canvas can stand in. */
export interface DrawTarget {
  readonly width: number;
  readonly height: number;
  getContext(kind: "2d"): CanvasRenderingContext2D | null;
}

export function pixelSize(
  layout: ReceiptLayout,
  dpi: number,
): { w: number; h: number; dpi: number } {
  const mm = 25.4;
  let used = dpi;
  let h = Math.round((layout.lengthMm / mm) * used);
  if (h > MAX_TEXTURE_PX) {
    // Reduce resolution rather than clip content.
    used = Math.floor((MAX_TEXTURE_PX * mm) / layout.lengthMm);
    h = Math.round((layout.lengthMm / mm) * used);
  }
  return { w: Math.round((layout.options.widthMm / mm) * used), h, dpi: used };
}

export function drawReceipt(
  target: DrawTarget,
  layout: ReceiptLayout,
  _dpi: number,
  fontFamily: string,
): void {
  const ctx = target.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  const o = layout.options;
  const { width: w, height: h } = target;
  const mmToPx = w / o.widthMm;
  const rand = mulberry32(0x5eed);

  ctx.fillStyle = `rgb(${PAPER_RGB[0]},${PAPER_RGB[1]},${PAPER_RGB[2]})`;
  ctx.fillRect(0, 0, w, h);

  // Head wear: the print head fades slightly toward one edge.
  const wear = ctx.createLinearGradient(0, 0, w, 0);
  wear.addColorStop(0, "rgba(0,0,0,0.00)");
  wear.addColorStop(0.82, "rgba(0,0,0,0.02)");
  wear.addColorStop(1, "rgba(0,0,0,0.05)");
  ctx.fillStyle = wear;
  ctx.fillRect(0, 0, w, h);

  const fontPx = o.fontSizeMm * mmToPx;
  const linePx = fontPx * o.lineHeightRatio;
  ctx.font = `${fontPx}px "${fontFamily}", monospace`;
  ctx.textBaseline = "alphabetic";

  // Centre the text block on the paper rather than pinning it to the left
  // margin. Lines are usually shorter than the wrap width, and left-aligning
  // dumps all the slack on the right-hand side. Alignment inside the block is
  // untouched, so monospace columns still line up.
  let longest = 0;
  for (const line of layout.lines) longest = Math.max(longest, line.length);
  const blockMm = longest * o.fontSizeMm * MONO_ADVANCE_EM;
  const x = Math.max(o.marginMm, (o.widthMm - blockMm) / 2) * mmToPx;

  layout.lines.forEach((line, i) => {
    // Per-row density jitter: thermal rows burn unevenly.
    const density = 0.82 + rand() * 0.18;
    ctx.fillStyle = `rgba(${INK_RGB[0]},${INK_RGB[1]},${INK_RGB[2]},${density})`;
    ctx.fillText(line, x, o.padTopMm * mmToPx + i * linePx + fontPx);
  });

  // Banding from the feed motor.
  ctx.fillStyle = "rgba(0,0,0,0.012)";
  for (let y = 0; y < h; y += 3) {
    if (rand() > 0.6) ctx.fillRect(0, y, w, 1);
  }

  drawBarcode(ctx, layout, mmToPx, h, rand);
  punchTornEdges(ctx, mmToPx, w, h);
}

/**
 * Serrated ends, cut out of the canvas alpha so the mesh is alpha-tested into
 * a torn silhouette. A receipt is torn off a roll; square ends read as a card.
 */
function punchTornEdges(
  ctx: CanvasRenderingContext2D,
  mmToPx: number,
  w: number,
  h: number,
): void {
  const toothW = 4 * mmToPx;
  const toothH = 1.8 * mmToPx;
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "#000";
  for (const top of [true, false]) {
    const edge = top ? 0 : h;
    const inner = top ? toothH : h - toothH;
    ctx.beginPath();
    ctx.moveTo(0, edge);
    for (let x = 0; x < w + toothW; x += toothW) {
      ctx.lineTo(x + toothW / 2, inner);
      ctx.lineTo(x + toothW, edge);
    }
    ctx.lineTo(w, edge);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawBarcode(
  ctx: CanvasRenderingContext2D,
  layout: ReceiptLayout,
  mmToPx: number,
  h: number,
  rand: () => number,
): void {
  const o = layout.options;
  const barHeight = 8 * mmToPx;
  const top = h - o.padBottomMm * mmToPx + 2 * mmToPx;
  if (top + barHeight > h) return;
  const left = o.marginMm * mmToPx;
  const right = (o.widthMm - o.marginMm) * mmToPx;
  ctx.fillStyle = `rgb(${INK_RGB[0]},${INK_RGB[1]},${INK_RGB[2]})`;
  let x = left;
  while (x < right) {
    const barW = 1 + Math.floor(rand() * 3);
    if (rand() > 0.42) ctx.fillRect(x, top, barW, barHeight);
    x += barW + 1 + Math.floor(rand() * 2);
  }
}

export function inkMask(target: DrawTarget): Uint8Array {
  const ctx = target.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  const { width: w, height: h } = target;
  const { data } = ctx.getImageData(0, 0, w, h);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    // 0 is bare paper, 255 is fully burnt.
    const lum = data[i * 4]!;
    mask[i] = Math.max(0, Math.min(255, Math.round(((PAPER_RGB[0] - lum) / PAPER_RGB[0]) * 255)));
  }
  return mask;
}
