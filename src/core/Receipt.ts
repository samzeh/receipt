import {
  CanvasTexture, DataTexture, EquirectangularReflectionMapping, Group, Mesh,
  type MeshPhysicalMaterial, PMREMGenerator, RGBAFormat, Scene, SRGBColorSpace,
  type Texture, WebGLRenderer,
} from "three";
import { createPointerRig, meshPicker, type PointerRig } from "../input/pointer";
import { buildGeometry, syncGeometry } from "../render/mesh";
import { createPaperMaterial } from "../render/paperMaterial";
import { createStudio, type Studio } from "../scene/studio";
import { Cloth, DEFAULT_PARAMS, substepsFor, type ClothParams } from "../sim/Cloth";
import { drawReceipt, inkMask, pixelSize, type DrawTarget } from "../text/draw";
import { DEFAULT_LAYOUT, layoutReceipt, type ReceiptLayout } from "../text/layout";

const SIM_STEP = 1 / 120;
const MAX_STEPS_PER_FRAME = 4;
const FONT_FAMILY = "JetBrains Mono";
/** How much of the frame the receipt leaves empty. 1 fills it edge to edge. */
const FRAME_PADDING = 1.6;

export interface ReceiptError {
  code: "no-webgl" | "context-lost" | "clamped" | "diverged";
  message: string;
}

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

/** The slice of WebGLRenderer this module uses, so tests can stand one in. */
export interface RendererLike {
  domElement: HTMLCanvasElement;
  setSize(w: number, h: number, updateStyle?: boolean): void;
  setPixelRatio(ratio: number): void;
  render(scene: Scene, camera: Studio["camera"]): void;
  dispose(): void;
}

export interface ReceiptDeps {
  createRenderer: (canvas: HTMLCanvasElement) => RendererLike;
  createCanvas: (w: number, h: number) => HTMLCanvasElement;
  requestFrame: (cb: (t: number) => void) => number;
  cancelFrame: (id: number) => void;
}

function defaultDeps(): ReceiptDeps {
  return {
    createRenderer: (canvas) =>
      new WebGLRenderer({ canvas, antialias: true, alpha: true }) as unknown as RendererLike,
    createCanvas: (w, h) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      return c;
    },
    requestFrame: (cb) => requestAnimationFrame(cb),
    cancelFrame: (id) => cancelAnimationFrame(id),
  };
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
  const d: ReceiptDeps = { ...defaultDeps(), ...deps };
  const widthMm = options.widthMm ?? DEFAULT_LAYOUT.widthMm;
  const dpi = options.dpi ?? 300;
  const anchor = options.anchor ?? "none";
  const reducedMotion = options.reducedMotion ?? prefersReducedMotion();
  const fail = (code: ReceiptError["code"], message: string): void =>
    options.onError?.({ code, message });

  let disposed = false;
  let running = true;
  let frameId: number | null = null;
  let last = 0;
  let accumulator = 0;
  let reportedDiverged = false;
  let piece: Piece | null = null;
  let observer: IntersectionObserver | null = null;
  let resizer: ResizeObserver | null = null;

  const width = Math.max(1, container.clientWidth || 640);
  const height = Math.max(1, container.clientHeight || 480);

  // --- texture + simulation construction -------------------------------------

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
    const dist =
      Math.max(h / (2 * vTan), w / (2 * hTan)) * FRAME_PADDING + (maxZ - minZ) / 2;
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

  // --- scene -----------------------------------------------------------------

  const scene = new Scene();
  const studio = createStudio(width / height);
  const group = new Group();
  scene.add(group);
  for (const light of studio.lights) scene.add(light);

  // --- renderer --------------------------------------------------------------

  let renderer: RendererLike;
  try {
    renderer = d.createRenderer(d.createCanvas(width, height));
  } catch (e) {
    fail("no-webgl", e instanceof Error ? e.message : "renderer unavailable");
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

  renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio ?? 1));
  // updateStyle must stay on: with it off, three sets only the canvas's
  // attribute size, so at devicePixelRatio 2 the element lays out at twice the
  // viewport and everything but its top-left quarter is off-screen.
  renderer.setSize(width, height, true);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  container.appendChild(renderer.domElement);

  if (renderer instanceof WebGLRenderer) {
    const pmrem = new PMREMGenerator(renderer);
    scene.environment = pmrem.fromEquirectangular(studio.environment).texture;
    pmrem.dispose();
  } else {
    studio.environment.mapping = EquirectangularReflectionMapping;
    scene.environment = studio.environment;
  }

  piece = build(options.text);
  group.add(piece.mesh);
  centreOn(piece);

  // --- input -----------------------------------------------------------------

  const canvasEl = renderer.domElement;
  const toNdc = (e: PointerEvent): [number, number] => {
    const r = canvasEl.getBoundingClientRect();
    const w = r.width || width;
    const h = r.height || height;
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
  const onContextLost = (e: Event): void => {
    e.preventDefault();
    running = false;
    fail("context-lost", "webgl context lost");
  };
  const onVisibility = (): void => {
    running = document.visibilityState !== "hidden";
  };

  canvasEl.addEventListener("pointerdown", onDown);
  canvasEl.addEventListener("pointermove", onMove);
  canvasEl.addEventListener("pointerup", onUp);
  canvasEl.addEventListener("pointercancel", onUp);
  canvasEl.addEventListener("webglcontextlost", onContextLost);
  document.addEventListener("visibilitychange", onVisibility);

  // Without this the drawing buffer keeps its mount-time size while CSS
  // stretches the canvas, so a resized window skews the image off-centre.
  if (typeof ResizeObserver !== "undefined") {
    resizer = new ResizeObserver(() => {
      const w = Math.max(1, container.clientWidth || width);
      const h = Math.max(1, container.clientHeight || height);
      renderer.setSize(w, h, true);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      studio.camera.aspect = w / h;
      studio.camera.updateProjectionMatrix();
      if (piece) centreOn(piece);
    });
    resizer.observe(container);
  }

  if (typeof IntersectionObserver !== "undefined") {
    observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (entry) running = entry.isIntersecting;
    });
    observer.observe(container);
  }

  // --- loop ------------------------------------------------------------------

  function frame(t: number): void {
    if (disposed) return;
    frameId = d.requestFrame(frame);
    if (!running || !piece) {
      last = t;
      return;
    }
    const dt = last === 0 ? 0 : Math.min(0.25, (t - last) / 1000);
    last = t;
    accumulator += dt;
    let steps = 0;
    while (accumulator >= SIM_STEP && steps < MAX_STEPS_PER_FRAME) {
      piece.rig.update();
      piece.cloth.step(SIM_STEP);
      accumulator -= SIM_STEP;
      steps += 1;
    }
    // Drop any backlog beyond the cap rather than chasing it forever.
    if (accumulator > SIM_STEP * MAX_STEPS_PER_FRAME) accumulator = 0;

    if (piece.cloth.diverged && !reportedDiverged) {
      reportedDiverged = true;
      fail("diverged", "simulation diverged and was reset");
    }
    syncGeometry(piece.mesh.geometry, piece.cloth);
    renderer.render(scene, studio.camera);
  }

  frameId = d.requestFrame(frame);
  options.onReady?.();

  return {
    setText(text: string): void {
      if (disposed || !piece) return;
      destroyPiece(piece);
      piece = build(text);
      group.add(piece.mesh);
      centreOn(piece);
      accumulator = 0;
      last = 0;
    },

    recenter(): void {
      if (disposed || !piece) return;
      centreOn(piece);
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (frameId !== null) d.cancelFrame(frameId);
      observer?.disconnect();
      resizer?.disconnect();
      canvasEl.removeEventListener("pointerdown", onDown);
      canvasEl.removeEventListener("pointermove", onMove);
      canvasEl.removeEventListener("pointerup", onUp);
      canvasEl.removeEventListener("pointercancel", onUp);
      canvasEl.removeEventListener("webglcontextlost", onContextLost);
      document.removeEventListener("visibilitychange", onVisibility);
      if (piece) destroyPiece(piece);
      piece = null;
      studio.environment.dispose();
      scene.environment?.dispose();
      renderer.dispose();
      container.replaceChildren();
    },
  };
}
