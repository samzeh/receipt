import { CanvasTexture, DataTexture, Group, Mesh, RGBAFormat, SRGBColorSpace } from "three";
import type { MeshPhysicalMaterial, Texture } from "three";
import { createPointerRig, meshPicker, type PointerRig } from "../input/pointer";
import { buildGeometry, syncGeometry } from "../render/mesh";
import { createPaperMaterial } from "../render/paperMaterial";
import { Cloth, DEFAULT_PARAMS, substepsFor, type ClothParams } from "../sim/Cloth";
import { drawReceipt, inkMask, pixelSize, type DrawTarget } from "../text/draw";
import { DEFAULT_LAYOUT, layoutReceipt, type ReceiptLayout } from "../text/layout";
import {
  createStage,
  defaultStageDeps,
  type RendererLike,
  type StageDeps,
  type StageError,
} from "./stage";

const FONT_FAMILY = "JetBrains Mono";
/** How much of the frame the receipt leaves empty. 1 fills it edge to edge. */
const FRAME_PADDING = 1.6;

export type ReceiptError = StageError;
export type ReceiptDeps = StageDeps;
export type { RendererLike };

export interface ReceiptOptions {
  text: string;
  widthMm?: number;
  dpi?: number;
  anchor?: "top" | "none";
  paper?: Partial<{
    gsm: number;
    thicknessMm: number;
    bendComplianceAlong: number;
    bendComplianceAcross: number;
    restCurlRadiusMm: number;
    dragCoefficient: number;
    damping: number;
    gravity: number;
    grabRadiusMm: number;
    grabCompliance: number;
  }>;
  reducedMotion?: boolean;
  onReady?: () => void;
  onError?: (e: ReceiptError) => void;
}

export interface ReceiptHandle {
  setText(text: string): void;
  /** Re-frames the camera on where the receipt actually is now. */
  recenter(): void;
  dispose(): void;
}

function prefersReducedMotion(): boolean {
  if (typeof matchMedia !== "function") return false;
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function resolveParams(
  options: ReceiptOptions,
  rows: number,
  widthMm: number,
  reducedMotion: boolean,
  anchor: "top" | "none",
): ClothParams {
  const p = options.paper ?? {};
  const cols = DEFAULT_PARAMS.cols;
  return {
    ...DEFAULT_PARAMS,
    cols,
    rows,
    spacing: widthMm / 1000 / (cols - 1),
    arealDensity: (p.gsm ?? 55) / 1000,
    // An unpinned sheet is meant to be picked up and moved around, so it
    // floats rather than falling out of frame the moment it is released.
    gravity: p.gravity ?? (anchor === "top" ? DEFAULT_PARAMS.gravity : 0),
    substeps: substepsFor(rows),
    bendComplianceAlongPerMetre: p.bendComplianceAlong ?? DEFAULT_PARAMS.bendComplianceAlongPerMetre,
    bendComplianceAcrossPerMetre:
      p.bendComplianceAcross ?? DEFAULT_PARAMS.bendComplianceAcrossPerMetre,
    restCurlRadius: (p.restCurlRadiusMm ?? DEFAULT_PARAMS.restCurlRadius * 1000) / 1000,
    dragCoefficient: p.dragCoefficient ?? DEFAULT_PARAMS.dragCoefficient,
    // Reduced motion settles the paper almost immediately instead of letting
    // it swing; grabbing still works.
    damping: p.damping ?? (reducedMotion ? 8 : DEFAULT_PARAMS.damping),
    grabRadius: (p.grabRadiusMm ?? DEFAULT_PARAMS.grabRadius * 1000) / 1000,
    grabCompliance: p.grabCompliance ?? DEFAULT_PARAMS.grabCompliance,
  };
}

/** Roughness from the ink mask: bare paper is rough, thermal print is glossier. */
function roughnessFromInk(target: DrawTarget): DataTexture {
  const mask = inkMask(target);
  const { width: w, height: h } = target;
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = 255 - mask[i]!;
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const t = new DataTexture(data, w, h, RGBAFormat);
  t.needsUpdate = true;
  return t;
}

interface Piece {
  layout: ReceiptLayout;
  cloth: Cloth;
  mesh: Mesh;
  material: MeshPhysicalMaterial;
  textures: Texture[];
  rig: PointerRig;
}

export function createReceipt(
  container: HTMLElement,
  options: ReceiptOptions,
  deps?: Partial<ReceiptDeps>,
): ReceiptHandle {
  const d: ReceiptDeps = { ...defaultStageDeps(), ...deps };
  const widthMm = options.widthMm ?? DEFAULT_LAYOUT.widthMm;
  const dpi = options.dpi ?? 300;
  const anchor = options.anchor ?? "none";
  const reducedMotion = options.reducedMotion ?? prefersReducedMotion();
  const fail = (code: ReceiptError["code"], message: string): void =>
    options.onError?.({ code, message });

  let disposed = false;
  let reportedDiverged = false;
  let piece: Piece | null = null;

  function draw(text: string): { canvas: HTMLCanvasElement; layout: ReceiptLayout } {
    const layout = layoutReceipt(text, { widthMm });
    if (layout.clamped) {
      fail("clamped", `receipt clamped to ${layout.gridRows} rows`);
    }
    const size = pixelSize(layout, dpi);
    const canvas = d.createCanvas(size.w, size.h);
    drawReceipt(canvas as unknown as DrawTarget, layout, size.dpi, FONT_FAMILY);
    return { canvas, layout };
  }

  // --- stage -----------------------------------------------------------------

  const stage = createStage(container, d, {
    step: (h) => {
      if (!piece) return;
      piece.rig.update();
      piece.cloth.step(h);
    },
    frame: () => {
      if (!piece) return;
      if (piece.cloth.diverged && !reportedDiverged) {
        reportedDiverged = true;
        fail("diverged", "simulation diverged and was reset");
      }
      syncGeometry(piece.mesh.geometry, piece.cloth);
    },
    resize: () => {
      if (piece) centreOn(piece);
    },
    error: (e) => options.onError?.(e),
  });

  // No renderer: the text path needs no GPU, so show a flat image of the
  // receipt rather than nothing at all.
  if (!stage) {
    const { canvas } = draw(options.text);
    const img = document.createElement("img");
    img.alt = "receipt";
    try {
      img.src = canvas.toDataURL();
    } catch {
      img.src = "";
    }
    img.style.maxWidth = "100%";
    container.appendChild(img);
    return {
      setText: () => {},
      recenter: () => {},
      dispose: () => container.replaceChildren(),
    };
  }

  const studio = stage.studio;
  const group = new Group();
  stage.scene.add(group);

  // --- piece construction ----------------------------------------------------

  function build(text: string): Piece {
    const { canvas, layout } = draw(text);
    const albedo = new CanvasTexture(canvas);
    albedo.colorSpace = SRGBColorSpace;
    const roughness = roughnessFromInk(canvas as unknown as DrawTarget);

    const params = resolveParams(options, layout.gridRows, widthMm, reducedMotion, anchor);
    const cloth = new Cloth(params);
    if (anchor === "top") {
      for (let c = 0; c < cloth.cols; c++) cloth.pin(cloth.index(c, 0));
    }
    const geometry = buildGeometry(cloth.cols, cloth.rows, params.spacing);
    const material = createPaperMaterial(albedo, roughness);
    const mesh = new Mesh(geometry, material);
    syncGeometry(geometry, cloth);

    const rig = createPointerRig(
      cloth,
      studio.camera,
      meshPicker(mesh, cloth, studio.camera),
      (v) => mesh.worldToLocal(v),
    );
    return { layout, cloth, mesh, material, textures: [albedo, roughness], rig };
  }

  function centreOn(p: Piece): void {
    const params = resolveParams(options, p.layout.gridRows, widthMm, reducedMotion, anchor);

    // Grid rows quantise the strip to whole cells, and short receipts hit the
    // 12-row floor, so the mesh is longer than the text it carries. Scale y to
    // the measured text length rather than stretching the print to fit.
    const meshLength = (p.cloth.rows - 1) * params.spacing;
    const scaleY = meshLength > 0 ? p.layout.lengthMm / 1000 / meshLength : 1;
    group.scale.set(1, scaleY, 1);

    // Measure the actual mesh rather than assuming a flat layout: the curled
    // rest shape is already centred on x, so offsetting by -width/2 would push
    // the whole receipt off to one side.
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < p.cloth.count; i++) {
      const x = p.cloth.pos[i * 3]!;
      const y = p.cloth.pos[i * 3 + 1]! * scaleY;
      const z = p.cloth.pos[i * 3 + 2]!;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    group.position.set(-(minX + maxX) / 2, -(minY + maxY) / 2, -(minZ + maxZ) / 2);

    const w = maxX - minX;
    const h = maxY - minY;
    const vTan = Math.tan(((studio.camera.fov / 2) * Math.PI) / 180);
    const hTan = vTan * studio.camera.aspect;
    const dist = Math.max(h / (2 * vTan), w / (2 * hTan)) * FRAME_PADDING + (maxZ - minZ) / 2;
    studio.camera.position.set(0, 0, dist);
    studio.camera.lookAt(0, 0, 0);
    studio.camera.updateMatrixWorld(true);
  }

  function destroyPiece(p: Piece): void {
    p.mesh.geometry.dispose();
    p.material.dispose();
    for (const t of p.textures) t.dispose();
    group.remove(p.mesh);
  }

  piece = build(options.text);
  group.add(piece.mesh);
  centreOn(piece);

  // --- input -----------------------------------------------------------------

  const canvasEl = stage.canvas;
  const toNdc = (e: PointerEvent): [number, number] => {
    const r = canvasEl.getBoundingClientRect();
    const w = r.width || stage.width;
    const h = r.height || stage.height;
    return [((e.clientX - r.left) / w) * 2 - 1, -(((e.clientY - r.top) / h) * 2 - 1)];
  };
  const onDown = (e: PointerEvent): void => {
    const [x, y] = toNdc(e);
    piece?.rig.pointerDown(x, y);
    canvasEl.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent): void => {
    const [x, y] = toNdc(e);
    piece?.rig.pointerMove(x, y);
  };
  const onUp = (): void => piece?.rig.pointerUp();

  canvasEl.addEventListener("pointerdown", onDown);
  canvasEl.addEventListener("pointermove", onMove);
  canvasEl.addEventListener("pointerup", onUp);
  canvasEl.addEventListener("pointercancel", onUp);

  options.onReady?.();

  return {
    setText(text: string): void {
      if (disposed || !piece) return;
      destroyPiece(piece);
      piece = build(text);
      group.add(piece.mesh);
      centreOn(piece);
      stage.resetClock();
    },

    recenter(): void {
      if (disposed || !piece) return;
      centreOn(piece);
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      canvasEl.removeEventListener("pointerdown", onDown);
      canvasEl.removeEventListener("pointermove", onMove);
      canvasEl.removeEventListener("pointerup", onUp);
      canvasEl.removeEventListener("pointercancel", onUp);
      if (piece) destroyPiece(piece);
      piece = null;
      stage.dispose();
    },
  };
}
