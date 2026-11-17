import {
  BufferAttribute, type BufferGeometry, CanvasTexture, DataTexture, ExtrudeGeometry, Group, LinearFilter,
  type Material, Mesh, MeshPhysicalMaterial, RepeatWrapping, RGBAFormat, Shape,
  SRGBColorSpace, type Texture, Vector2, Vector3,
} from "three";
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

  /** EMV contact plate. Roughly 12 x 9.5mm on a real card. */
  chipWidth: 0.012,
  chipHeight: 0.0095,
  chipRadius: 0.0009,
  /** Measured from the card's centre. The chip sits left of centre and a
   *  little above it, as on any EMV card. */
  chipX: -0.0188,
  chipY: 0.0055,
  /** Chips stand very slightly proud of the card face. */
  chipProud: 0.00004,
} as const;

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
export function makeChipTexture(w = 512, h = 406): Texture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Base gold, with a faint vertical gradient so the plate is not uniform.
  const base = ctx.createLinearGradient(0, 0, 0, h);
  base.addColorStop(0, "#e8c877");
  base.addColorStop(0.45, "#cfa94f");
  base.addColorStop(1, "#b89441");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  // Etched gaps between contacts. Dark, thin, and slightly soft.
  ctx.strokeStyle = "#6b5520";
  ctx.lineWidth = Math.round(w * 0.016);
  ctx.lineCap = "round";

  const inset = w * 0.1;
  const midY = h / 2;
  const gapY = h * 0.1;

  ctx.beginPath();
  // The horizontal split across the whole plate.
  ctx.moveTo(inset * 0.4, midY);
  ctx.lineTo(w - inset * 0.4, midY);
  // Two vertical dividers on each half, making the familiar six-pad grid.
  for (const x of [w * 0.34, w * 0.66]) {
    ctx.moveTo(x, h * 0.08);
    ctx.lineTo(x, midY - gapY * 0.1);
    ctx.moveTo(x, midY + gapY * 0.1);
    ctx.lineTo(x, h * 0.92);
  }
  // The central contact's island.
  ctx.moveTo(w * 0.42, midY - gapY);
  ctx.lineTo(w * 0.58, midY - gapY);
  ctx.moveTo(w * 0.42, midY + gapY);
  ctx.lineTo(w * 0.58, midY + gapY);
  ctx.stroke();

  // A darker rim, so the plate reads as set into the card.
  ctx.strokeStyle = "rgba(90,70,25,0.55)";
  ctx.lineWidth = Math.round(w * 0.022);
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);

  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export function createCard(): Card {
  const group = new Group();
  group.name = "card";

  const brushed = makeBrushedNormalMap();
  const bodyMat = new MeshPhysicalMaterial({
    color: 0x2c2f34,
    metalness: 1,
    roughness: 0.34,
    normalMap: brushed,
    // Scratches run across the card, so the highlight stretches along it.
    normalScale: new Vector2(0.35, 0.35),
    clearcoat: 0.35,
    clearcoatRoughness: 0.22,
  });

  const body = new Mesh(
    plateGeometry(CARD.width, CARD.height, CARD.cornerRadius, CARD.thickness),
    bodyMat,
  );
  body.name = "body";
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const chipMap = makeChipTexture();
  const chipMat = new MeshPhysicalMaterial({
    color: chipMap ? 0xffffff : 0xc9a14a,
    map: chipMap ?? null,
    metalness: 1,
    roughness: 0.17,
    clearcoat: 0.6,
    clearcoatRoughness: 0.12,
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
    // Chip first, so the short edge nearest the chip leads.
    insertEdge: new Vector3(-CARD.width / 2, 0, 0),
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
      chipMap?.dispose();
      for (const m of materials) m.dispose();
      group.clear();
    },
  };
}
