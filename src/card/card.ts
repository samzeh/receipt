import {
  BufferAttribute, type BufferGeometry, CanvasTexture, DataTexture, ExtrudeGeometry, Group,
  LinearFilter, LinearMipmapLinearFilter, NearestFilter, ShapeGeometry,
  type Material, Mesh, MeshPhysicalMaterial, RepeatWrapping, RGBAFormat, Shape,
  SRGBColorSpace, type Texture, Vector2, Vector3,
} from "three";
import { CHARACTER_PALETTE, CHARACTER_PIXELS } from "./character";
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
  chipX: 0.023,
  chipY: -0.003,
  /** Chips stand very slightly proud of the card face. */
  chipProud: 0.00004,
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
 * Width of each bar as a fraction of the cloud's own width.
 *
 * A narrow bar on top, a wide body, a tapered underside — four bars for a
 * cloud three or four times as wide as it is tall. Six bars of similar width
 * makes a lump; this is what makes it drift.
 */
export const CLOUD_SHAPE: readonly number[] = [0.38, 0.9, 1, 0.68];

/**
 * One cloud, as a stack of horizontal runs.
 *
 * Pure, so the shape is testable without a canvas.
 */
export function cloudRuns(width: number, seed: number, shape = CLOUD_SHAPE): CloudRun[] {
  const rand = mulberry32(seed);
  return shape.map((fraction, r) => {
    const w = Math.max(2, Math.round(width * fraction * (0.86 + rand() * 0.14)));
    const x = Math.round((width - w) * rand());
    return { x, y: r, width: w };
  });
}

/**
 * Clouds, in coarse blocks. They are painted before the hills and before the
 * character, so one may sit behind the figure — which is what puts the
 * character in the scene rather than on top of it.
 */
const CLOUDS = [
  { x: 2, y: 3, width: 17, seed: 0x3f21 },
  { x: 24, y: 6, width: 15, seed: 0x8ad4 },
  { x: 36, y: 1, width: 12, seed: 0x16bc },
] as const;

/**
 * The landscape is painted in 2x2 blocks while the character is painted at
 * one pixel each.
 *
 * They are drawn at different pixel sizes on purpose: the hills want blocks
 * about a fiftieth of the card wide, and a face with eyes and eyebrows cannot
 * be drawn at that size. One grid for both means either a blocky landscape
 * and no character, or a readable character and a landscape that stops
 * looking like pixel art.
 */
const BLOCK = 3;

/**
 * Where the character stands, in fine pixels. Positioned to match the source
 * artwork: a tenth of the way in from the left, feet in the grass.
 */
const CHARACTER_AT = { x: 13, y: 16 } as const;

const CLOUD_BODY = "#f1f6fd";
/** The underside and the ends, a touch bluer than the body. */
const CLOUD_EDGE = "#d7e6f7";

/** Sky and hills, in the order they are painted: highest band first. */
const LANDSCAPE = {
  sky: "#86d0fb",
  bands: [
    { color: "#80c74a", base: 0.76, rise: 0.11, step: 3, jitter: 1, seed: 0x51a2 },
    { color: "#6fb83c", base: 0.87, rise: 0.07, step: 3, jitter: 1, seed: 0x7c3e },
    { color: "#5aa130", base: 0.94, rise: 0.04, step: 4, jitter: 1, seed: 0x2d91 },
  ] as HorizonBand[] & { color: string }[],
} as const;

/**
 * The card's face: a pixel-art landscape.
 *
 * Drawn at one canvas pixel per art pixel and magnified with a nearest
 * filter, so the blocks stay hard-edged however close the camera gets.
 * Drawing it large and downscaling would antialias away the entire point.
 */
export function makeFaceTexture(
  withCharacter = true,
  cols = 150,
  rows = 96,
): Texture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;

  const coarseCols = Math.floor(cols / BLOCK);
  const coarseRows = Math.floor(rows / BLOCK);
  /** Paints one coarse block. */
  const block = (x: number, y: number, w: number, h: number): void =>
    ctx.fillRect(x * BLOCK, y * BLOCK, w * BLOCK, h * BLOCK);

  ctx.fillStyle = LANDSCAPE.sky;
  ctx.fillRect(0, 0, cols, rows);

  // Clouds go on before the hills, so a hill would occlude one rather than
  // the other way round.
  for (const cloud of CLOUDS) {
    const runs = cloudRuns(cloud.width, cloud.seed);
    runs.forEach((run, i) => {
      // The lowest run is the shaded underside.
      ctx.fillStyle = i === runs.length - 1 ? CLOUD_EDGE : CLOUD_BODY;
      block(cloud.x + run.x, cloud.y + run.y, run.width, 1);
      // Tint both ends, so each bar has a defined edge instead of stopping.
      ctx.fillStyle = CLOUD_EDGE;
      block(cloud.x + run.x, cloud.y + run.y, 1, 1);
      block(cloud.x + run.x + run.width - 1, cloud.y + run.y, 1, 1);
    });
  }

  for (const band of LANDSCAPE.bands) {
    const profile = pixelHorizon(coarseCols, coarseRows, band);
    ctx.fillStyle = band.color;
    for (let x = 0; x < coarseCols; x++) {
      const top = profile[x]!;
      if (top >= coarseRows) continue;
      // Down to the canvas edge rather than to the last whole block: when
      // rows is not a multiple of BLOCK the remainder is left as sky, which
      // shows as a strip of blue under the grass.
      ctx.fillRect(x * BLOCK, top * BLOCK, BLOCK, rows - top * BLOCK);
    }
  }

  // The character last, so it stands in front of the hills.
  if (withCharacter) {
    const CHARS = "0123456789abcdefghijklmnopqrstuvwxyz";
    CHARACTER_PIXELS.forEach((line, row) => {
      for (let col = 0; col < line.length; col++) {
        const colour = CHARACTER_PALETTE[CHARS.indexOf(line[col]!)];
        if (!colour) continue;
        ctx.fillStyle = colour;
        ctx.fillRect(CHARACTER_AT.x + col, CHARACTER_AT.y + row, 1, 1);
      }
    });
  }

  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  // Hard pixels on magnification; mipmaps still handle minification, so the
  // card does not shimmer when it is small or steeply tilted.
  t.magFilter = NearestFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
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
export function makeChipMaps(
  w = 512,
  h = 462,
): { map: Texture; roughnessMap: Texture } | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  /** Rounded rectangle as a path, since roundRect is not everywhere. */
  const roundedPath = (x: number, y: number, rw: number, rh: number, r: number): void => {
    const rad = Math.min(r, rw / 2, rh / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + rw, y, x + rw, y + rh, rad);
    ctx.arcTo(x + rw, y + rh, x, y + rh, rad);
    ctx.arcTo(x, y + rh, x, y, rad);
    ctx.arcTo(x, y, x + rw, y, rad);
    ctx.closePath();
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

  // The fine mesh across the plate. Barely visible up close and entirely
  // responsible for it not looking like flat paint.
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

  // Etched gaps between contacts. A groove in bright plating is only a little
  // darker than the plating around it; pushing it dark turns the chip into a
  // line drawing.
  ctx.strokeStyle = "#a3a9b1";
  ctx.lineWidth = Math.round(w * 0.014);
  ctx.lineCap = "round";
  ctx.beginPath();
  // Columns.
  ctx.moveTo(left, top);
  ctx.lineTo(left, bottom);
  ctx.moveTo(right, top);
  ctx.lineTo(right, bottom);
  // Three pads down each side.
  for (const y of [h * 0.36, h * 0.64]) {
    ctx.moveTo(w * 0.06, y);
    ctx.lineTo(left, y);
    ctx.moveTo(right, y);
    ctx.lineTo(w * 0.94, y);
  }
  // Angled cuts at the bottom corners.
  ctx.moveTo(w * 0.06, h * 0.84);
  ctx.lineTo(w * 0.15, h * 0.945);
  ctx.moveTo(w * 0.94, h * 0.84);
  ctx.lineTo(w * 0.85, h * 0.945);
  ctx.stroke();

  // The waisted central island: wide through the middle, pinched top and
  // bottom. It is the shape that makes a chip read as a chip.
  ctx.beginPath();
  ctx.moveTo(w * 0.43, top + h * 0.06);
  ctx.bezierCurveTo(w * 0.355, h * 0.26, w * 0.355, h * 0.74, w * 0.43, bottom - h * 0.06);
  ctx.lineTo(w * 0.57, bottom - h * 0.06);
  ctx.bezierCurveTo(w * 0.645, h * 0.74, w * 0.645, h * 0.26, w * 0.57, top + h * 0.06);
  ctx.closePath();
  ctx.stroke();

  // Bond-wire dots in a couple of the pads.
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

  // A soft rim, so the plate reads as set into the card.
  ctx.strokeStyle = "rgba(166,172,180,0.6)";
  ctx.lineWidth = Math.round(w * 0.018);
  roundedPath(
    ctx.lineWidth / 2,
    ctx.lineWidth / 2,
    w - ctx.lineWidth,
    h - ctx.lineWidth,
    w * 0.11,
  );
  ctx.stroke();

  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  map.needsUpdate = true;

  // Roughness derived from the art rather than drawn twice: the polished pads
  // are the bright areas and the etched gaps are the dark ones, so inverting
  // luminance gives smooth pads and matte etching for free.
  const roughCanvas = document.createElement("canvas");
  roughCanvas.width = w;
  roughCanvas.height = h;
  const roughCtx = roughCanvas.getContext("2d");
  if (!roughCtx) return null;
  const image = ctx.getImageData(0, 0, w, h);
  const pixels = image.data;
  for (let i = 0; i < pixels.length; i += 4) {
    // Compressed, not a straight inversion. The etched gaps are the same
    // plating as the pads — just recessed — so they stay reflective. Letting
    // them run to full roughness makes them read as matte ink drawn on
    // plastic rather than as grooves cut into metal.
    const inverted = 255 - pixels[i]!;
    const rough = Math.round(26 + inverted * 0.26);
    pixels[i] = rough;
    pixels[i + 1] = rough;
    pixels[i + 2] = rough;
  }
  roughCtx.putImageData(image, 0, 0);

  const roughnessMap = new CanvasTexture(roughCanvas);
  roughnessMap.needsUpdate = true;

  return { map, roughnessMap };
}

export function createCard(): Card {
  const group = new Group();
  group.name = "card";

  const brushed = makeBrushedNormalMap();
  // A printed card under lacquer, not bare metal. On a metal a colour map is
  // reflectance tint, so artwork would render as tinted chrome rather than as
  // print; the ink has to sit on a dielectric. The clearcoat is the laminate,
  // and it is what keeps the chip reading as the one metal thing on the card.
  const printed = (map: Texture | null, fallback: number): MeshPhysicalMaterial =>
    new MeshPhysicalMaterial({
      color: map ? 0xffffff : fallback,
      map,
      metalness: 0.12,
      roughness: 0.4,
      normalMap: brushed,
      // Very faint: a strong micro-normal smears the pixel edges, which is
      // the one thing this artwork cannot survive.
      normalScale: new Vector2(0.06, 0.06),
      clearcoat: 0.6,
      clearcoatRoughness: 0.1,
      envMapIntensity: 1,
    });

  // Same landscape on both sides; the character is on the front only.
  const face = makeFaceTexture(true);
  const backFace = makeFaceTexture(false);

  // The substrate carries the front artwork too, so the card's edge is
  // printed rather than a dark rim. planarUV puts the side walls on the
  // texture's perimeter, so the edge is sky along the top and grass along the
  // bottom on its own — which is what an edge-printed card looks like.
  const bodyMat = printed(face, 0x2c2f34);

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
  const frontMat = printed(face, 0x2c2f34);
  const backMat = printed(backFace, 0x232830);

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

  const front = new Mesh(facePlate(), frontMat);
  front.name = "front";
  front.position.z = CARD.thickness / 2 + 2e-6;
  group.add(front);

  const back = new Mesh(facePlate(), backMat);
  back.name = "back";
  back.position.z = -CARD.thickness / 2 - 2e-6;
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
    roughnessMap: chipMaps?.roughnessMap ?? null,
    metalness: 1,
    roughness: chipMaps ? 1 : 0.18,
    clearcoat: 0,
    // Metal reflects nearly all of what hits it, so this multiplies straight
    // into the highlight. Above about 1 the plate clips and the etched
    // pattern disappears into flat white.
    envMapIntensity: 0.85,
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

  const anchors: CardAnchors = {
    chip: new Vector3(CARD.chipX, CARD.chipY, CARD.thickness / 2),
    face: new Vector3(0, 0, 1),
    // Chip first, so whichever short edge the chip sits nearest leads.
    insertEdge: new Vector3(Math.sign(CARD.chipX) * (CARD.width / 2), 0, 0),
  };

  return {
    group,
    anchors,
    dispose(): void {
      const geometries = new Set<BufferGeometry>();
      const materials = new Set<Material>();
      group.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        geometries.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
      });
      for (const g of geometries) g.dispose();
      brushed.dispose();
      face?.dispose();
      backFace?.dispose();
      chipMaps?.map.dispose();
      chipMaps?.roughnessMap.dispose();
      for (const m of materials) m.dispose();
      group.clear();
    },
  };
}
