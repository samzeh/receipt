import { Raycaster, Vector2 } from "three";
import { createStage, defaultStageDeps } from "../src/core/stage";
import { CARD, createCard } from "../src/card/card";
import {
  createPoseTween, nearestFront, nextHalfTurn, squareFront, type Pose,
} from "../src/card/pose";

// The card on an off-white field. No ground, no shadow, no orbit: the camera
// is fixed and the only thing that moves is the card.
//
// Click turns it over. Double-click runs the way in: the second flip lands it
// square to the camera and the view pushes in, which is the state the game
// will run in.

const BACKDROP = 0xf2f0ec;

/** Resting pose: square to the camera and held at arm's length. */
const REST_X = 0;
const REST_Y = 0;
const REST_ZOOM = 2.26;
/** How far the card can be tipped before it reads as falling over. */
const PITCH_LIMIT = 1.15;
/** Seconds-ish constant for the spin to coast to a stop after release. */
const DECAY = 3.4;
const FLIP_TIME = 0.6;
const ZOOM_TIME = 0.75;
/** Coming out, the card spins a full turn while the camera pulls back. */
const EXIT_TIME = 0.85;
/** A pointer that moved less than this many pixels was a click, not a drag. */
const CLICK_SLOP = 5;
/** Two clicks closer together than this are a double-click. */
const DOUBLE_MS = 350;
/** How close the camera sits once it has pushed in. Close enough to play on,
 *  far enough that the whole card is still in frame. */
const GAME_ZOOM = 0.78;

type Phase = "idle" | "entering" | "ready";

const el = document.querySelector<HTMLElement>("#stage")!;
const card = createCard();

let phase: Phase = "idle";
let velX = 0;
let velY = 0;
let dragging = false;
let lastX = 0;
let lastY = 0;
let travelled = 0;
let lastClickAt = 0;
let since = 0;
/** 0 shows the display face, 1 the playfield. Chased, not tweened, so it can
 *  be redirected mid-flight when you come straight back out. */
let mix = 0;
let mixTarget = 0;

const clampPitch = (v: number): number => Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, v));

const rest: Pose = { rotX: REST_X, rotY: REST_Y, zoom: REST_ZOOM };
const view = createPoseTween(rest);
const moveTo = view.moveTo.bind(view);

const stage = createStage(
  el,
  defaultStageDeps(),
  {
    frame: (dt) => {
      if (view.update(dt)) {
        frameCard();
      } else if (!dragging && phase === "idle" && dt > 0) {
        view.set({
          rotY: view.pose.rotY + velY,
          rotX: clampPitch(view.pose.rotX + velX),
        });
        const decay = Math.exp(-DECAY * dt);
        velX *= decay;
        velY *= decay;
      }
      if (dt > 0 && Math.abs(mixTarget - mix) > 0.0005) {
        mix += (mixTarget - mix) * (1 - Math.exp(-dt * 4.5));
        card.setGameMix(mix);
      }
      card.group.rotation.set(view.pose.rotX, view.pose.rotY, 0);
      // Live pose readout, throttled: handy for reading a pose you like back
      // into the source as the new resting position.
      since += dt;
      if (since > 0.1) {
        since = 0;
        report();
      }
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
const ZOOM_MIN = 0.45;
const ZOOM_MAX = 4;

function frameCard(): void {
  const vTan = Math.tan(((camera.fov / 2) * Math.PI) / 180);
  const hTan = vTan * camera.aspect;
  // A rotated card never projects larger than its flat silhouette, so fitting
  // the face with margin is enough for every pose.
  const fitted = Math.max(CARD.height / (2 * vTan), CARD.width / (2 * hTan)) * 1.5;
  camera.position.set(0, 0, fitted * view.pose.zoom);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
}
frameCard();

// --- the way in and out -----------------------------------------------------

function enter(): void {
  phase = "entering";
  velX = 0;
  velY = 0;
  // Flip to the front and level it in one move, then push the camera in.
  // Landing square matters: the game is played on the face of the card.
  moveTo({ rotX: 0, rotY: squareFront(view.pose.rotY) }, FLIP_TIME, () => {
    // The scene changes over as the camera moves in, so the shrink and the
    // push arrive together rather than as two separate events.
    mixTarget = 1;
    moveTo({ zoom: GAME_ZOOM }, ZOOM_TIME, () => {
      phase = "ready";
      report();
      // The game starts here.
    });
  });
  report();
}

function exit(): void {
  if (phase === "idle") return;
  phase = "idle";
  velX = 0;
  velY = 0;
  mixTarget = 0;
  // A full turn backwards while the camera pulls back, landing on the resting
  // pose. The spin is the point — without it the exit is only a zoom, and
  // there is nothing to watch.
  moveTo(
    { rotX: REST_X, rotY: nearestFront(view.pose.rotY) - 2 * Math.PI, zoom: REST_ZOOM },
    EXIT_TIME,
    report,
  );
  report();
}

// --- pointer ----------------------------------------------------------------

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
  if (phase !== "idle") return;
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
  travelled = 0;
  velX = 0;
  velY = 0;
  // Taking hold of the card cancels a flip, so a drag always wins.
  view.cancel();
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
  view.set({
    rotY: view.pose.rotY + velY,
    rotX: clampPitch(view.pose.rotX + velX),
  });
});

const release = (e?: PointerEvent): void => {
  if (!dragging) return;
  dragging = false;
  canvas.style.cursor = "grab";
  if (!e || travelled >= CLICK_SLOP || !overCard(e)) return;

  const now = performance.now();
  const isDouble = now - lastClickAt < DOUBLE_MS;
  lastClickAt = now;

  // The first click of a double has already flipped the card to its back,
  // which is step one of the sequence — so the second click just carries on.
  // Waiting out a double-click window on every click would make a plain flip
  // feel broken for the sake of a secret.
  if (isDouble) {
    lastClickAt = 0;
    enter();
    return;
  }

  velX = 0;
  velY = 0;
  moveTo({ rotY: nextHalfTurn(view.pose.rotY, REST_Y) }, FLIP_TIME);
};
canvas.addEventListener("pointerup", release);
canvas.addEventListener("pointercancel", () => release());

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    if (phase !== "idle" || view.busy) return;
    // Exponential, so a notch feels the same close up as far away.
    view.set({
      zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.pose.zoom * Math.exp(e.deltaY * 0.0012))),
    });
    frameCard();
  },
  { passive: false },
);

// Always a way back out, so a secret cannot strand you in it.
addEventListener("keydown", (e) => {
  if (e.key === "Escape") exit();
});

// --- hud --------------------------------------------------------------------

const mm = (m: number): string => `${(m * 1000).toFixed(2)}mm`;
const hud = document.createElement("pre");
hud.id = "hud";
document.body.appendChild(hud);

function report(): void {
  const f = (v: number): string => v.toFixed(3).padStart(7);
  hud.textContent = [
    `card        ${mm(CARD.width)} x ${mm(CARD.height)} (ISO ID-1)`,
    `phase       ${phase}`,
    ``,
    `rotX      ${f(view.pose.rotX)}`,
    `rotY      ${f(view.pose.rotY)}`,
    `zoom      ${f(view.pose.zoom)}`,
    ``,
    phase === "idle"
      ? `drag to turn, click to flip, double-click to zoom in`
      : `esc to come back out`,
  ].join("\n");
}
report();
