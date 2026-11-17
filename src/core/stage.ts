import {
  ACESFilmicToneMapping, Color, EquirectangularReflectionMapping, PCFSoftShadowMap,
  PMREMGenerator, Scene, WebGLRenderer,
} from "three";
import { createStudio, type Studio, type StudioMode } from "../scene/studio";

/**
 * The renderer, the scene, and the fixed-step loop — everything a three.js
 * scene needs that has nothing to do with what is in it.
 *
 * Extracted so the plain receipt and the card terminal share one copy. This is
 * where the silent bugs lived (a suppressed canvas CSS size, a stale drawing
 * buffer after resize, an undisposed environment map), and a second hand-rolled
 * copy would not have been through any of that.
 */

/** Fixed simulation timestep. Compliance enters XPBD divided by h squared, so a
 *  variable dt silently rescales every stiffness in the sheet. */
export const SIM_STEP = 1 / 120;
export const MAX_STEPS_PER_FRAME = 4;

export interface StageError {
  code: "no-webgl" | "context-lost" | "clamped" | "diverged";
  message: string;
}

/** The slice of WebGLRenderer this module uses, so tests can stand one in. */
export interface RendererLike {
  domElement: HTMLCanvasElement;
  setSize(w: number, h: number, updateStyle?: boolean): void;
  setPixelRatio(ratio: number): void;
  render(scene: Scene, camera: Studio["camera"]): void;
  dispose(): void;
}

export interface StageDeps {
  createRenderer: (canvas: HTMLCanvasElement) => RendererLike;
  createCanvas: (w: number, h: number) => HTMLCanvasElement;
  requestFrame: (cb: (t: number) => void) => number;
  cancelFrame: (id: number) => void;
}

export function defaultStageDeps(): StageDeps {
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

export interface StageOptions {
  /** Cast and receive shadows. Needs lights configured for the scene's scale
   *  — see enableShadows in the studio. */
  shadows?: boolean;
  /** ACES exposure. Raise it if the grade comes out dark. */
  exposure?: number;
  /** Lighting preset. "dark" is the receipt's void; "light" is a product
   *  sweep for objects on an off-white backdrop. */
  studio?: StudioMode;
  /** Solid scene background. Omit to leave the canvas transparent. */
  background?: number;
}

export interface StageHooks {
  /** One fixed simulation step. Called 0..MAX_STEPS_PER_FRAME times per frame. */
  step?: (h: number) => void;
  /** Once per frame, after stepping and before rendering. Wall-clock seconds,
   *  for anything visual that should not be quantised to the sim step. */
  frame?: (dt: number) => void;
  /** After the drawing buffer and camera aspect have been updated. */
  resize?: (w: number, h: number) => void;
  error?: (e: StageError) => void;
}

export interface Stage {
  readonly scene: Scene;
  readonly studio: Studio;
  readonly canvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
  /** Forget the accumulated time debt. For callers that have just done
   *  something expensive and do not want the loop to catch up across it. */
  resetClock(): void;
  dispose(): void;
}

/**
 * Returns null when a renderer cannot be created, leaving the caller to decide
 * its own fallback — the receipt shows a flat image of itself, which is not a
 * decision this module should be making.
 */
export function createStage(
  container: HTMLElement,
  deps: StageDeps,
  hooks: StageHooks = {},
  options: StageOptions = {},
): Stage | null {
  let width = Math.max(1, container.clientWidth || 640);
  let height = Math.max(1, container.clientHeight || 480);

  let renderer: RendererLike;
  try {
    renderer = deps.createRenderer(deps.createCanvas(width, height));
  } catch (e) {
    hooks.error?.({
      code: "no-webgl",
      message: e instanceof Error ? e.message : "renderer unavailable",
    });
    return null;
  }

  const scene = new Scene();
  const studio = createStudio(width / height, options.studio);
  if (options.background !== undefined) scene.background = new Color(options.background);
  for (const light of studio.lights) scene.add(light);

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
    // Linear output clips every highlight to flat white, which is most of
    // what makes a render look computed rather than photographed. ACES rolls
    // them off the way film does.
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = options.exposure ?? 1.25;
    if (options.shadows) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = PCFSoftShadowMap;
    }

    const pmrem = new PMREMGenerator(renderer);
    scene.environment = pmrem.fromEquirectangular(studio.environment).texture;
    pmrem.dispose();
  } else {
    studio.environment.mapping = EquirectangularReflectionMapping;
    scene.environment = studio.environment;
  }

  const canvas = renderer.domElement;
  let disposed = false;
  let running = true;
  let frameId: number | null = null;
  let last = 0;
  let accumulator = 0;

  const onContextLost = (e: Event): void => {
    e.preventDefault();
    running = false;
    hooks.error?.({ code: "context-lost", message: "webgl context lost" });
  };
  const onVisibility = (): void => {
    running = document.visibilityState !== "hidden";
  };
  canvas.addEventListener("webglcontextlost", onContextLost);
  document.addEventListener("visibilitychange", onVisibility);

  // Without this the drawing buffer keeps its mount-time size while CSS
  // stretches the canvas, so a resized window skews the image off-centre.
  let resizer: ResizeObserver | null = null;
  if (typeof ResizeObserver !== "undefined") {
    resizer = new ResizeObserver(() => {
      width = Math.max(1, container.clientWidth || width);
      height = Math.max(1, container.clientHeight || height);
      renderer.setSize(width, height, true);
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      studio.camera.aspect = width / height;
      studio.camera.updateProjectionMatrix();
      hooks.resize?.(width, height);
    });
    resizer.observe(container);
  }

  let observer: IntersectionObserver | null = null;
  if (typeof IntersectionObserver !== "undefined") {
    observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (entry) running = entry.isIntersecting;
    });
    observer.observe(container);
  }

  function frame(t: number): void {
    if (disposed) return;
    frameId = deps.requestFrame(frame);
    if (!running) {
      last = t;
      return;
    }
    const dt = last === 0 ? 0 : Math.min(0.25, (t - last) / 1000);
    last = t;
    accumulator += dt;
    let steps = 0;
    while (accumulator >= SIM_STEP && steps < MAX_STEPS_PER_FRAME) {
      hooks.step?.(SIM_STEP);
      accumulator -= SIM_STEP;
      steps += 1;
    }
    // Drop any backlog beyond the cap rather than chasing it forever.
    if (accumulator > SIM_STEP * MAX_STEPS_PER_FRAME) accumulator = 0;
    hooks.frame?.(dt);
    renderer.render(scene, studio.camera);
  }

  frameId = deps.requestFrame(frame);

  return {
    scene,
    studio,
    canvas,
    get width() {
      return width;
    },
    get height() {
      return height;
    },

    resetClock(): void {
      accumulator = 0;
      last = 0;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (frameId !== null) deps.cancelFrame(frameId);
      observer?.disconnect();
      resizer?.disconnect();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      document.removeEventListener("visibilitychange", onVisibility);
      studio.environment.dispose();
      scene.environment?.dispose();
      renderer.dispose();
      container.replaceChildren();
    },
  };
}
