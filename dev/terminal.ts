import { Box3, Mesh, MeshPhysicalMaterial, PlaneGeometry, Raycaster, Vector2, Vector3 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createStage, defaultStageDeps } from "../src/core/stage";
import { enableShadows } from "../src/scene/studio";
import { createTerminalBody, RAMP_ANGLE, TERMINAL } from "../src/terminal/body";

// A bare page for judging the terminal by eye: no paper, no sequence, just
// the machine, an orbit camera, and keys you can press.

const el = document.querySelector<HTMLElement>("#stage")!;

let controls: OrbitControls | null = null;

const body = createTerminalBody();

const stage = createStage(
  el,
  defaultStageDeps(),
  {
    frame: (dt) => {
      controls?.update();
      body.update(dt);
    },
    error: (e) => console.warn("[terminal]", e.code, e.message),
  },
  { shadows: true, exposure: 1.3 },
);
if (!stage) throw new Error("no webgl");

stage.scene.add(body.group);

// A counter to sit on. The contact shadow is what grounds the machine; in a
// void it reads as a floating render however good the materials are.
const counter = new Mesh(
  new PlaneGeometry(1.2, 1.2),
  new MeshPhysicalMaterial({ color: 0x0c0d10, roughness: 0.42, metalness: 0, clearcoat: 0.2 }),
);
counter.name = "counter";
counter.rotation.x = -Math.PI / 2;
counter.position.y = -0.0002;
counter.receiveShadow = true;
stage.scene.add(counter);

// The key light needs a shadow frustum sized to a 185mm object, not the
// ten-metre default.
enableShadows(stage.studio, TERMINAL.length * 0.75, { x: 0, y: TERMINAL.crownTop / 2, z: 0 });
stage.scene.add(stage.studio.key.target);

const box = new Box3().setFromObject(body.group);
const centre = box.getCenter(new Vector3());
const size = box.getSize(new Vector3());

const camera = stage.studio.camera;
const vTan = Math.tan(((camera.fov / 2) * Math.PI) / 180);
const hTan = vTan * camera.aspect;
const dist = Math.max(size.y / (2 * vTan), size.z / (2 * hTan)) * 1.9;
camera.position.set(centre.x + dist * 0.42, centre.y + dist * 0.5, centre.z + dist * 0.78);
camera.lookAt(centre);

controls = new OrbitControls(camera, stage.canvas);
controls.target.copy(centre);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.update();

// --- key presses ------------------------------------------------------------

const raycaster = new Raycaster();
const ndc = new Vector2();
let pressed = "none";
let downAt: { x: number; y: number } | null = null;

stage.canvas.addEventListener("pointerdown", (e) => {
  downAt = { x: e.clientX, y: e.clientY };
});

stage.canvas.addEventListener("pointerup", (e) => {
  // Only count it as a click if the pointer barely moved, so orbiting the
  // camera across a key does not press it.
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  downAt = null;
  if (moved > 4) return;

  const r = stage.canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
  raycaster.setFromCamera(ndc, camera);

  for (const hit of raycaster.intersectObjects(body.keyMeshes, false)) {
    const index = body.keyIndexAt(hit.object, hit.instanceId);
    if (index < 0) continue;
    body.press(index);
    pressed = body.anchors.keys[index]!.label;
    report();
    return;
  }
});

// --- hud --------------------------------------------------------------------

const mm = (m: number): string => `${(m * 1000).toFixed(1)}mm`;
const hud = document.createElement("pre");
hud.id = "hud";
document.body.appendChild(hud);

function report(): void {
  hud.textContent = [
    `paper       ${mm(TERMINAL.paperWidth)} (terminal stock, not till stock)`,
    `body        ${mm(TERMINAL.width)} x ${mm(TERMINAL.length)}`,
    `keypad top  ${mm(TERMINAL.keypadTop)}`,
    `ramp        ${((RAMP_ANGLE * 180) / Math.PI).toFixed(1)}deg, keypad -> crown`,
    `crown top   ${mm(TERMINAL.crownTop)}`,
    `paper slot  ${mm(TERMINAL.paperSlotWidth)} at z ${mm(TERMINAL.paperSlotZ)}`,
    `card slot   ${mm(TERMINAL.cardSlotWidth)} at y ${mm(TERMINAL.cardSlotY)}`,
    `screen      ${mm(TERMINAL.screenWidth)} x ${mm(TERMINAL.screenLength)}`,
    `measured    ${mm(size.x)} w x ${mm(size.z)} d x ${mm(size.y)} h`,
    ``,
    `last key    ${pressed}`,
    `drag to orbit, click a key`,
  ].join("\n");
}
report();
