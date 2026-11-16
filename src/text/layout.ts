/** JetBrains Mono's advance width, in ems. The font is monospace, so layout
 *  needs no text measurement and stays pure and machine-independent. */
export const MONO_ADVANCE_EM = 0.6;

export interface LayoutOptions {
  widthMm: number;
  marginMm: number;
  fontSizeMm: number;
  lineHeightRatio: number;
  padTopMm: number;
  padBottomMm: number;
  maxRows: number;
  spacingMm: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  widthMm: 80,
  marginMm: 5,
  fontSizeMm: 3.4,
  lineHeightRatio: 1.45,
  padTopMm: 8,
  padBottomMm: 14,
  maxRows: 400,
  spacingMm: 80 / 11,
};

export interface ReceiptLayout {
  lines: string[];
  lineCount: number;
  lengthMm: number;
  gridRows: number;
  clamped: boolean;
  options: LayoutOptions;
  charsPerLine: number;
}

export function gridRowsFor(
  lengthMm: number,
  spacingMm: number,
  maxRows: number,
): { rows: number; clamped: boolean } {
  const raw = Math.round(lengthMm / spacingMm) + 1;
  if (raw > maxRows) return { rows: maxRows, clamped: true };
  return { rows: Math.max(12, raw), clamped: false };
}

function wrapLine(line: string, charsPerLine: number): string[] {
  if (line.length <= charsPerLine) return [line];
  const out: string[] = [];
  let rest = line;
  while (rest.length > charsPerLine) {
    const window = rest.slice(0, charsPerLine + 1);
    const cut = window.lastIndexOf(" ");
    if (cut <= 0) {
      out.push(rest.slice(0, charsPerLine));
      rest = rest.slice(charsPerLine);
    } else {
      out.push(rest.slice(0, cut));
      rest = rest.slice(cut + 1);
    }
  }
  out.push(rest);
  return out;
}

export function layoutReceipt(text: string, options?: Partial<LayoutOptions>): ReceiptLayout {
  const o: LayoutOptions = { ...DEFAULT_LAYOUT, ...options };
  const usableMm = o.widthMm - 2 * o.marginMm;
  const charsPerLine = Math.max(1, Math.floor(usableMm / (o.fontSizeMm * MONO_ADVANCE_EM)));
  const lines =
    text.length === 0
      ? []
      : text
          .replace(/\r\n?/g, "\n")
          .split("\n")
          .flatMap((l) => wrapLine(l, charsPerLine));
  const lineHeightMm = o.fontSizeMm * o.lineHeightRatio;
  const lengthMm = o.padTopMm + lines.length * lineHeightMm + o.padBottomMm;
  const { rows, clamped } = gridRowsFor(lengthMm, o.spacingMm, o.maxRows);
  return {
    lines,
    lineCount: lines.length,
    lengthMm,
    gridRows: rows,
    clamped,
    options: o,
    charsPerLine,
  };
}
