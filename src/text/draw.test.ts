import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { drawReceipt, inkMask, PAPER_RGB, pixelSize, type DrawTarget } from "./draw";
import { layoutReceipt } from "./layout";

const require = createRequire(import.meta.url);
GlobalFonts.registerFromPath(
  require.resolve("@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2"),
  "JBMono",
);

function render(text: string, dpi = 300) {
  const layout = layoutReceipt(text);
  const { w, h, dpi: used } = pixelSize(layout, dpi);
  const canvas = createCanvas(w, h);
  drawReceipt(canvas as unknown as DrawTarget, layout, used, "JBMono");
  return { canvas, layout, w, h };
}

describe("pixelSize", () => {
  it("is 80mm wide at the requested dpi", () => {
    const { w } = pixelSize(layoutReceipt("A"), 300);
    expect(w).toBe(Math.round((80 / 25.4) * 300));
  });

  it("reduces dpi rather than clipping tall receipts", () => {
    const tall = layoutReceipt("line\n".repeat(380));
    const { h, dpi } = pixelSize(tall, 300);
    expect(h).toBeLessThanOrEqual(4096);
    expect(dpi).toBeLessThan(300);
  });
});

describe("drawReceipt", () => {
  it("puts ink where the glyphs are", () => {
    const { canvas, layout, w, h } = render("TOTAL");
    const ctx = canvas.getContext("2d");
    const mmToPx = w / layout.options.widthMm;
    const y = Math.round((layout.options.padTopMm + layout.options.fontSizeMm * 0.5) * mmToPx);
    const row = ctx.getImageData(0, y, w, 1).data;
    let darkest = 255;
    for (let x = 0; x < w; x++) darkest = Math.min(darkest, row[x * 4]!);
    expect(darkest).toBeLessThan(PAPER_RGB[0] - 60);
    expect(h).toBeGreaterThan(0);
  });

  it("leaves the margins free of ink", () => {
    const { canvas, layout, w } = render("TOTAL 42 BOOKS");
    const ctx = canvas.getContext("2d");
    const mmToPx = w / layout.options.widthMm;
    const marginPx = Math.floor(layout.options.marginMm * mmToPx) - 2;
    const y = Math.round((layout.options.padTopMm + layout.options.fontSizeMm * 0.5) * mmToPx);
    const row = ctx.getImageData(0, y, w, 1).data;
    for (let x = 0; x < marginPx; x++) expect(row[x * 4]!).toBeGreaterThan(PAPER_RGB[0] - 40);
  });

  it("cuts torn teeth out of the top and bottom edges", () => {
    const { canvas, w, h } = render("TOTAL");
    const ctx = canvas.getContext("2d");
    const clearFraction = (y: number): number => {
      const row = ctx.getImageData(0, y, w, 1).data;
      let clear = 0;
      for (let x = 0; x < w; x++) if (row[x * 4 + 3]! === 0) clear += 1;
      return clear / w;
    };
    // The edge rows are mostly cut away by the teeth; mid-sheet stays solid.
    expect(clearFraction(0)).toBeGreaterThan(0.3);
    expect(clearFraction(h - 1)).toBeGreaterThan(0.3);
    expect(clearFraction(Math.floor(h / 2))).toBe(0);
  });

  it("centres the text block on the paper", () => {
    // Lines are usually shorter than the wrap width; left-aligning the block
    // dumps every bit of slack on the right-hand side.
    // Equal-length lines, so the block edges and the line edges coincide.
    const { canvas, layout, w } = render("ABCDE\nFGHIJ");
    const ctx = canvas.getContext("2d");
    const mmToPx = w / layout.options.widthMm;
    const y = Math.round((layout.options.padTopMm + layout.options.fontSizeMm * 0.5) * mmToPx);
    const row = ctx.getImageData(0, y, w, 1).data;
    let first = -1;
    let last = -1;
    for (let px = 0; px < w; px++) {
      if (row[px * 4]! < PAPER_RGB[0] - 60) {
        if (first < 0) first = px;
        last = px;
      }
    }
    expect(first).toBeGreaterThan(0);
    const inkCentre = (first + last) / 2;
    expect(Math.abs(inkCentre - w / 2) / w).toBeLessThan(0.02);
  });

  it("is deterministic across runs", () => {
    const a = render("SAME TEXT").canvas.toBuffer("image/png");
    const b = render("SAME TEXT").canvas.toBuffer("image/png");
    expect(Buffer.compare(a, b)).toBe(0);
  });

  it("produces a non-empty ink mask", () => {
    const { canvas } = render("TOTAL");
    const mask = inkMask(canvas as unknown as DrawTarget);
    expect(mask.some((v) => v > 80)).toBe(true);
    expect(mask.every((v) => v === 255)).toBe(false);
  });
});
