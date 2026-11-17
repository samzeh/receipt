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

const el = document.querySelector<HTMLElement>("#stage")!;

const card = createCard();

let rotX = REST_X;
let rotY = REST_Y;
let velX = 0;
let velY = 0;
let dragging = false;
let lastX = 0;
let lastY = 0;

const clampPitch = (v: number): number => Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, v));

const stage = createStage(
  el,
  defaultStageDeps(),
  {
    frame: (dt) => {
      if (!dragging && dt > 0) {
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
  { studio: "light", background: BACKDROP, exposure: 1.05 },
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

canvas.addEventListener("pointerdown", (e) => {
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
  velX = 0;
  velY = 0;
  canvas.style.cursor = "grabbing";
  canvas.setPointerCapture?.(e.pointerId);
});

canvas.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  // Scale by viewport width so a drag across the screen turns the card by
  // about the same amount on any display.
  const k = 4.2 / Math.max(1, canvas.clientWidth);
  velY = (e.clientX - lastX) * k;
  velX = (e.clientY - lastY) * k;
  lastX = e.clientX;
  lastY = e.clientY;
  rotY += velY;
  rotX = clampPitch(rotX + velX);
});

const release = (): void => {
  if (!dragging) return;
  dragging = false;
  canvas.style.cursor = "grab";
};
canvas.addEventListener("pointerup", release);
canvas.addEventListener("pointercancel", release);

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
  `drag the card, scroll to zoom`,
].join("\n");
document.body.appendChild(hud);
