import {
  BoxGeometry, type BufferGeometry, DataTexture, ExtrudeGeometry, Group, LinearFilter,
  type Material, Mesh, MeshPhysicalMaterial, type Object3D, RepeatWrapping, RGBAFormat,
  Shape, Vector2, Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mulberry32 } from "../text/rng";
import { createKeypad, type Keypad, type TerminalKey } from "./keypad";

/**
 * A countertop card terminal with an integrated printer, after the Ingenico
 * Desk/5000.
 *
 * The defining surface is the ramp: the top runs flat under the keypad, then
 * rises in one continuous grade to the printer crown, and the display lies on
 * that incline tilted toward the user. A flat fascia with a separate hump
 * behind it reads as a staircase; the ramp is what makes it a machine.
 *
 * The shell is ONE mass — a side profile extruded across the width — so the
 * crown belongs to the same surface as the fascia rather than sitting on it.
 *
 * Dimensions follow the real device, which prints 57mm paper. Metres
 * throughout. Front is +z, up is +y, and it sits on y = 0.
 */
export const TERMINAL = {
  /** The paper this machine is built around. A terminal is not a till. */
  paperWidth: 0.057,

  width: 0.083,
  length: 0.185,
  chinTop: 0.0215,

  /** Flat shelf carrying the keypad. */
  keypadTop: 0.032,
  keypadFrontZ: 0.08,
  keypadBackZ: 0.026,
  keypadZ: 0.053,

  /** The ramp runs from the back of the keypad up to the crown. */
  rampTopZ: -0.058,
  crownTop: 0.062,
  crownBackZ: -0.078,

  /** The display lies on the ramp. */
  screenZ: -0.014,
  screenWidth: 0.064,
  screenLength: 0.06,
  glassWidth: 0.07,
  glassLength: 0.066,

  paperSlotZ: -0.068,
  paperSlotWidth: 0.061,

  cardSlotY: 0.014,
  cardSlotWidth: 0.056,

  keyWidth: 0.013,
  keyDepth: 0.009,
  keyGap: 0.002,
  keyHeight: 0.0022,

  gripHeight: 0.016,
  gripLength: 0.115,
} as const;

/** Angle of the ramp carrying the display, rising toward the crown. */
export const RAMP_ANGLE = Math.atan2(
  TERMINAL.crownTop - TERMINAL.keypadTop,
  TERMINAL.keypadBackZ - TERMINAL.rampTopZ,
);

/** Height of the ramp surface at a given depth. */
export function rampY(z: number): number {
  return TERMINAL.keypadTop + (TERMINAL.keypadBackZ - z) * Math.tan(RAMP_ANGLE);
}

/** Outward normal of the ramp surface. */
export function rampNormal(): Vector3 {
  return new Vector3(0, Math.cos(RAMP_ANGLE), Math.sin(RAMP_ANGLE));
}

export type { TerminalKey };

export interface SlotAnchor {
  position: Vector3;
  /** Which way something travels through the slot. */
  direction: Vector3;
  width: number;
}

export interface TerminalAnchors {
  /** Where paper is emitted, and the direction it leaves in. */
  paperSlot: SlotAnchor;
  cardSlot: SlotAnchor;
  keys: TerminalKey[];
  screen: { position: Vector3; width: number; length: number; tilt: number };
}

export interface TerminalBody {
  group: Group;
  anchors: TerminalAnchors;
  /** Raycast these to detect a key press. */
  keyMeshes: Object3D[];
  /** Resolves a raycast hit to a key index, or -1. */
  keyIndexAt(object: Object3D, instanceId?: number): number;
  press(index: number): void;
  /** Advances key press animations. Wall-clock seconds. */
  update(dt: number): void;
  dispose(): void;
}

/**
 * Fine moulded dots for the rubber side grips. A flat inset panel reads as
 * paint; the texture is what makes it read as a bumper.
 */
export function makeGripNormalMap(size = 128, cell = 8): DataTexture {
  const data = new Uint8Array(size * size * 4);
  const rand = mulberry32(0x6a1b);
  const radius = cell * 0.34;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = (x % cell) - cell / 2 + 0.5;
      const dy = (y % cell) - cell / 2 + 0.5;
      const d = Math.hypot(dx, dy);
      let nx = 0;
      let ny = 0;
      if (d < radius && d > 1e-6) {
        const s = d / radius;
        nx = (dx / d) * s * 0.8;
        ny = (dy / d) * s * 0.8;
      }
      const jitter = (rand() - 0.5) * 0.05;
      const nz = Math.sqrt(Math.max(0.05, 1 - nx * nx - ny * ny));
      data[i] = Math.round((nx + jitter + 1) * 127.5);
      data[i + 1] = Math.round((ny + jitter + 1) * 127.5);
      data[i + 2] = Math.round((nz + 1) * 127.5);
      data[i + 3] = 255;
    }
  }
  const t = new DataTexture(data, size, size, RGBAFormat);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.repeat.set(12, 2);
  t.needsUpdate = true;
  return t;
}

/**
 * Low-frequency roughness variation for the shell.
 *
 * A moulded surface is never uniformly rough — there are faint broad patches
 * where it has been handled, wiped, or came out of the tool slightly
 * differently. Perfectly even roughness is one of the strongest tells that a
 * surface was computed. three multiplies `roughness` by this map's green
 * channel, so the values sit just under 1.
 */
export function makeImperfectionMap(size = 256, cells = 12): DataTexture {
  const rand = mulberry32(0x3c7f);
  // A coarse lattice, smoothly interpolated: cheap value noise.
  const lattice = new Float32Array((cells + 1) * (cells + 1));
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();

  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const at = (cx: number, cy: number): number =>
    lattice[(cy % (cells + 1)) * (cells + 1) + (cx % (cells + 1))]!;

  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const fy = (y / size) * cells;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = smooth(fx - x0);
      const ty = smooth(fy - y0);
      const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
      const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
      const n = top * (1 - ty) + bottom * ty;
      // 0.86..1.0 of the material's base roughness.
      const v = Math.round((0.86 + n * 0.14) * 255);
      const i = (y * size + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }

  const t = new DataTexture(data, size, size, RGBAFormat);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  // ExtrudeGeometry's UVs are in world metres, so this repeats every ~2cm.
  t.repeat.set(8, 8);
  t.needsUpdate = true;
  return t;
}

/** Roundover applied to every edge of the shell by the extrude bevel. */
const BEVEL = 0.005;

type P = [number, number];

/** Moves `from` toward `to` by `dist`, never past the midpoint. */
function inset(from: P, to: P, dist: number): P {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return [from[0], from[1]];
  const d = Math.min(dist, len / 2);
  return [from[0] + (dx / len) * d, from[1] + (dy / len) * d];
}

/** Walks a polyline, rounding each interior corner by its own radius. */
function roundedChain(s: Shape, pts: P[], radii: number[]): void {
  for (let i = 1; i < pts.length - 1; i++) {
    const curr = pts[i]!;
    const r = radii[i] ?? 0;
    const a = inset(curr, pts[i - 1]!, r);
    const b = inset(curr, pts[i + 1]!, r);
    s.lineTo(a[0], a[1]);
    s.quadraticCurveTo(curr[0], curr[1], b[0], b[1]);
  }
  const last = pts[pts.length - 1]!;
  s.lineTo(last[0], last[1]);
}

/**
 * The silhouette, drawn once in the depth/height plane. The bevel expands the
 * outline outward by BEVEL, so the profile is drawn inset by that much and the
 * bevel grows it back to the stated dimensions.
 */
function shellProfile(): Shape {
  const T = TERMINAL;
  const b = BEVEL;
  const front = T.length / 2 - b;
  const back = -(T.length / 2 - b);
  const r = 0.004;

  const chain: P[] = [
    [front, b + r],
    [front, T.chinTop - b], // top of the chin face, where the card goes in
    [T.keypadFrontZ, T.keypadTop - b], // chin rolls onto the keypad shelf
    [T.keypadBackZ, T.keypadTop - b], // flat shelf under the keys
    [T.rampTopZ, T.crownTop - b], // THE RAMP: one straight grade to the crown
    [T.crownBackZ, T.crownTop - b], // short crown plateau over the paper roll
    [back, 0.04], // down the back
    [back, b + r],
  ];
  const radii = [0, 0.005, 0.006, 0.013, 0.011, 0.013, 0.008, 0];

  const s = new Shape();
  s.moveTo(back + r, b);
  s.lineTo(front - r, b);
  s.quadraticCurveTo(front, b, front, b + r);
  roundedChain(s, chain, radii);
  s.quadraticCurveTo(back, b, back + r, b);
  s.closePath();
  return s;
}

function shellGeometry(): BufferGeometry {
  const g = new ExtrudeGeometry(shellProfile(), {
    depth: TERMINAL.width - 2 * BEVEL,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    bevelSegments: 5,
    curveSegments: 24,
  });
  // The profile is drawn in XY and extruded along z; rotate so the profile's
  // own axes become depth and height, and the extrusion becomes width.
  g.rotateY(-Math.PI / 2);
  g.computeBoundingBox();
  const box = g.boundingBox!;
  // Centre on x and z and stand it on y = 0, rather than reasoning about
  // where the bevel pushed things.
  g.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  return g;
}

export function createTerminalBody(): TerminalBody {
  const T = TERMINAL;
  const group = new Group();
  group.name = "terminal";

  // Soft-touch black: high roughness with a weak clearcoat, so it catches a
  // broad dull highlight along the ramp rather than a glassy one.
  const imperfection = makeImperfectionMap();
  const shellMat = new MeshPhysicalMaterial({
    color: 0x141518,
    roughness: 0.86,
    roughnessMap: imperfection,
    metalness: 0.02,
    clearcoat: 0.18,
    clearcoatRoughness: 0.62,
    clearcoatRoughnessMap: imperfection,
    sheen: 0.25,
    sheenRoughness: 0.9,
    sheenColor: 0x2a2d33,
  });
  const gripMat = new MeshPhysicalMaterial({
    color: 0x1d1f23,
    roughness: 0.97,
    normalMap: makeGripNormalMap(),
    normalScale: new Vector2(1, 1),
  });
  const darkMat = new MeshPhysicalMaterial({ color: 0x020203, roughness: 1 });
  const seamMat = new MeshPhysicalMaterial({ color: 0x0a0b0d, roughness: 0.9 });
  // Cover glass over a dimmer display: the parallax between the two is what
  // gives a screen depth instead of looking like a painted rectangle.
  const glassMat = new MeshPhysicalMaterial({
    color: 0x05060a,
    roughness: 0.04,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
  });
  const displayMat = new MeshPhysicalMaterial({
    color: 0x0a1424,
    roughness: 0.3,
    emissive: 0x16304f,
    emissiveIntensity: 0.9,
  });
  const tearMat = new MeshPhysicalMaterial({ color: 0xa8adb5, metalness: 1, roughness: 0.28 });

  const shell = new Mesh(shellGeometry(), shellMat);
  shell.name = "shell";
  group.add(shell);

  // --- screen, lying on the ramp -------------------------------------------

  const normal = rampNormal();
  const surface = new Vector3(0, rampY(T.screenZ), T.screenZ);

  const display = new Mesh(new BoxGeometry(T.screenWidth, 0.0008, T.screenLength), displayMat);
  display.name = "display";
  display.position.copy(surface).addScaledVector(normal, 0.0004);
  display.rotation.x = RAMP_ANGLE;
  group.add(display);

  const glass = new Mesh(
    new RoundedBoxGeometry(T.glassWidth, 0.0014, T.glassLength, 3, 0.0006),
    glassMat,
  );
  glass.name = "screen";
  glass.position.copy(surface).addScaledVector(normal, 0.0011);
  glass.rotation.x = RAMP_ANGLE;
  group.add(glass);

  // --- openings and seams ---------------------------------------------------

  const paperGap = new Mesh(new BoxGeometry(T.paperSlotWidth, 0.013, 0.0045), darkMat);
  paperGap.name = "paperSlot";
  paperGap.position.set(0, T.crownTop - 0.0062, T.paperSlotZ);
  group.add(paperGap);

  const tearBar = new Mesh(new BoxGeometry(T.paperSlotWidth + 0.005, 0.0022, 0.0035), tearMat);
  tearBar.name = "tearBar";
  tearBar.position.set(0, T.crownTop + 0.0005, T.paperSlotZ + 0.0052);
  group.add(tearBar);

  // The roll lid's part line, running across the crown.
  const lidSeam = new Mesh(new BoxGeometry(T.width - 0.008, 0.0016, 0.0012), seamMat);
  lidSeam.name = "lidSeam";
  lidSeam.position.set(0, T.crownTop - 0.0003, T.crownBackZ + 0.0015);
  group.add(lidSeam);

  const cardSlot = new Mesh(new BoxGeometry(T.cardSlotWidth, 0.0028, 0.006), darkMat);
  cardSlot.name = "cardSlot";
  cardSlot.position.set(0, T.cardSlotY, T.length / 2 - 0.0016);
  group.add(cardSlot);

  // --- keypad ---------------------------------------------------------------

  const keypad: Keypad = createKeypad({
    surfaceY: T.keypadTop,
    centreZ: T.keypadZ,
    keyWidth: T.keyWidth,
    keyDepth: T.keyDepth,
    keyGap: T.keyGap,
    keyHeight: T.keyHeight,
  });
  group.add(keypad.group);

  // --- side grips -----------------------------------------------------------

  for (const side of [-1, 1]) {
    const grip = new Mesh(
      new RoundedBoxGeometry(0.004, T.gripHeight, T.gripLength, 4, 0.0016),
      gripMat,
    );
    grip.name = `grip:${side > 0 ? "right" : "left"}`;
    grip.position.set(side * (T.width / 2 - 0.0006), 0.016, 0.014);
    group.add(grip);
  }

  // Everything casts and receives. A machine with no contact shadow floats,
  // however good its materials are.
  group.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    o.castShadow = true;
    o.receiveShadow = true;
  });

  const anchors: TerminalAnchors = {
    paperSlot: {
      position: new Vector3(0, T.crownTop, T.paperSlotZ),
      // Mostly up, leaning forward, so the paper clears the crown and then
      // drapes down over the ramp toward the viewer.
      direction: new Vector3(0, 0.97, 0.24).normalize(),
      width: T.paperSlotWidth,
    },
    cardSlot: {
      position: new Vector3(0, T.cardSlotY, T.length / 2),
      direction: new Vector3(0, 0, -1),
      width: T.cardSlotWidth,
    },
    keys: keypad.keys,
    screen: {
      position: surface.clone(),
      width: T.screenWidth,
      length: T.screenLength,
      tilt: RAMP_ANGLE,
    },
  };

  return {
    group,
    anchors,
    keyMeshes: keypad.meshes,
    keyIndexAt: (object, instanceId) => keypad.indexAt(object, instanceId),
    press: (index) => keypad.press(index),
    update: (dt) => keypad.update(dt),

    dispose(): void {
      keypad.dispose();
      const geometries = new Set<BufferGeometry>();
      const materials = new Set<Material>();
      group.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        geometries.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
      });
      for (const g of geometries) g.dispose();
      // Several materials share one generated texture, so dedupe before
      // disposing or the second dispose fires on a freed resource.
      const textures = new Set<DataTexture>();
      for (const m of materials) {
        const mat = m as MeshPhysicalMaterial;
        for (const map of [mat.normalMap, mat.roughnessMap, mat.clearcoatRoughnessMap]) {
          if (map) textures.add(map as DataTexture);
        }
      }
      for (const t of textures) t.dispose();
      for (const m of materials) m.dispose();
      group.clear();
    },
  };
}
