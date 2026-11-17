import { Raycaster, Vector2 } from "three";
import { createStage, defaultStageDeps } from "../src/core/stage";
import { CARD, createCard } from "../src/card/card";

// The blank card on an off-white field. No ground, no shadow, no orbit: the
// camera is fixed and the only thing that moves is the card.

const BACKDROP = 0xf2f0ec;

/** Resting pose: tipped so the face catches the key light rather than
 *  staring straight down the lens. */
const REST_X = -0.16;
const REST_Y = -0.38;
/** How far the card can be tipped before it reads as falling over. */
const PITCH_LIMIT = 1.15;
/** Seconds-ish constant for the spin to coast to a stop after release. */
const DECAY = 3.4;
/** How long a flip takes. Long enough to read as a turn, not a jump. */
const FLIP_TIME = 0.6;
/** A pointer that moved less than this many pixels was a click, not a drag. */
const CLICK_SLOP = 5;

const el = document.querySelector<HTMLElement>("#stage")!;

const card = createCard();

let rotX = REST_X;
let rotY = REST_Y;
let velX = 0;
let velY = 0;
let dragging = false;
let lastX = 0;
let lastY = 0;
let travelled = 0;
/** A flip in progress: where it started, where it is going, how far through. */
let flip: { from: number; to: number; t: number } | null = null;

const clampPitch = (v: number): number => Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, v));

const stage = createStage(
  el,
  defaultStageDeps(),
  {
    frame: (dt) => {
      if (flip && dt > 0) {
        flip.t = Math.min(1, flip.t + dt / FLIP_TIME);
        // Ease in and out: a flip that starts and stops abruptly reads as a
        // texture swap rather than as the card turning over.
        const t = flip.t;
        const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
        rotY = flip.from + (flip.to - flip.from) * eased;
        if (flip.t >= 1) flip = null;
      } else if (!dragging && dt > 0) {
        rotY += velY;
        rotX = clampPitch(rotX + velX);
        const decay = Math.exp(-DECAY * dt);
        velX *= decay;
        velY *= decay;
      }
      card.group.rotation.set(rotX, rotY, 0);
    },
    resize: () => frameCard(),
    error: (e) => console.warn("[card]", e.code, e.message),
  },
  { studio: "light", background: BACKDROP, exposure: 0.95 },
);
if (!stage) throw new Error("no webgl");

stage.scene.add(card.group);

// --- framing ----------------------------------------------------------------

const camera = stage.studio.camera;

/** Dolly, as a multiple of the distance that just fits the card. */
let zoom = 1;
const ZOOM_MIN = 0.45;
const ZOOM_MAX = 4;

function frameCard(): void {
  const vTan = Math.tan(((camera.fov / 2) * Math.PI) / 180);
  const hTan = vTan * camera.aspect;
  // A rotated card never projects larger than its flat silhouette, so fitting
  // the face with margin is enough for every pose.
  const fitted = Math.max(CARD.height / (2 * vTan), CARD.width / (2 * hTan)) * 1.5;
  camera.position.set(0, 0, fitted * zoom);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
}
frameCard();

// --- dragging the card ------------------------------------------------------

const canvas = stage.canvas;
canvas.style.cursor = "grab";

const raycaster = new Raycaster();
const ndc = new Vector2();

/** Whether a pointer event landed on the card rather than on empty space. */
function overCard(e: PointerEvent): boolean {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
  raycaster.setFromCamera(ndc, camera);
  return raycaster.intersectObject(card.group, true).length > 0;
}

canvas.addEventListener("pointerdown", (e) => {
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
  travelled = 0;
  velX = 0;
  velY = 0;
  // Taking hold of the card cancels a flip, so a drag always wins.
  flip = null;
  canvas.style.cursor = "grabbing";
  canvas.setPointerCapture?.(e.pointerId);
});

canvas.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  // Scale by viewport width so a drag across the screen turns the card by
  // about the same amount on any display.
  const k = 4.2 / Math.max(1, canvas.clientWidth);
  travelled += Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY);
  velY = (e.clientX - lastX) * k;
  velX = (e.clientY - lastY) * k;
  lastX = e.clientX;
  lastY = e.clientY;
  rotY += velY;
  rotX = clampPitch(rotX + velX);
});

const release = (e?: PointerEvent): void => {
  if (!dragging) return;
  dragging = false;
  canvas.style.cursor = "grab";

  // A click, not a drag, and on the card rather than past it: turn it over.
  // Half a turn from wherever it currently is, so a flip from a tilted pose
  // keeps its tilt instead of snapping square first.
  if (e && travelled < CLICK_SLOP && overCard(e)) {
    velX = 0;
    velY = 0;
    flip = { from: rotY, to: rotY + Math.PI, t: 0 };
  }
};
canvas.addEventListener("pointerup", release);
canvas.addEventListener("pointercancel", () => release());

// Dolly only — the camera's angle stays put, so the card is always framed
// head-on and only its own rotation changes the view.
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    // Exponential, so a notch feels the same close up as far away.
    zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * Math.exp(e.deltaY * 0.0012)));
    frameCard();
  },
  { passive: false },
);

// --- hud --------------------------------------------------------------------

const mm = (m: number): string => `${(m * 1000).toFixed(2)}mm`;
const hud = document.createElement("pre");
hud.id = "hud";
hud.textContent = [
  `card        ${mm(CARD.width)} x ${mm(CARD.height)} (ISO ID-1)`,
  `thickness   ${mm(CARD.thickness)}`,
  `corner      ${mm(CARD.cornerRadius)}`,
  `chip        ${mm(CARD.chipWidth)} x ${mm(CARD.chipHeight)}`,
  ``,
  `drag to turn, click to flip, scroll to zoom`,
].join("\n");
document.body.appendChild(hud);
