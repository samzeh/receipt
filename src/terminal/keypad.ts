import {
  type BufferGeometry, CanvasTexture, Group, InstancedMesh, type Material, Matrix4, Mesh,
  MeshBasicMaterial, MeshPhysicalMaterial, type Object3D, PlaneGeometry, SRGBColorSpace,
  type Texture, Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/**
 * The PIN pad: layout, meshes, labels, hit-testing and the press animation.
 *
 * Separate from the body because it is the only part of the machine that
 * holds state. Keys of one colour share an InstancedMesh, so sixteen keys
 * cost five draw calls, and instanced raycasting hands back the instance id
 * that identifies which key was hit.
 */

export type KeyRole = "digit" | "menu" | "cancel" | "correct" | "enter";

export interface TerminalKey {
  position: Vector3;
  label: string;
  role: KeyRole;
}

export interface KeypadOptions {
  /** Height of the surface the keys sit on. */
  surfaceY: number;
  /** Centre of the pad along the machine's length. */
  centreZ: number;
  keyWidth: number;
  keyDepth: number;
  keyGap: number;
  keyHeight: number;
}

export interface Keypad {
  group: Group;
  keys: TerminalKey[];
  /** Raycast these to find a press. */
  meshes: InstancedMesh[];
  /** Resolves a raycast hit to a key index, or -1. */
  indexAt(object: Object3D, instanceId?: number): number;
  press(index: number): void;
  /** Advances the press animation. Wall-clock seconds. */
  update(dt: number): void;
  dispose(): void;
}

/** The real device's layout: three digit columns plus a function column. */
const LAYOUT: { label: string; role: KeyRole }[][] = [
  [
    { label: "1", role: "digit" },
    { label: "2", role: "digit" },
    { label: "3", role: "digit" },
    { label: "menu", role: "menu" },
  ],
  [
    { label: "4", role: "digit" },
    { label: "5", role: "digit" },
    { label: "6", role: "digit" },
    { label: "cancel", role: "cancel" },
  ],
  [
    { label: "7", role: "digit" },
    { label: "8", role: "digit" },
    { label: "9", role: "digit" },
    { label: "correct", role: "correct" },
  ],
  [
    { label: "F", role: "digit" },
    { label: "0", role: "digit" },
    { label: ".#*", role: "digit" },
    { label: "enter", role: "enter" },
  ],
];

/** The little letter groups printed under the digits. */
const SUBLABEL: Record<string, string> = {
  "1": "QZ", "2": "ABC", "3": "DEF",
  "4": "GHI", "5": "JKL", "6": "MNO",
  "7": "PRS", "8": "TUV", "9": "WXY",
};

const TRAVEL = 0.0006;
/** Seconds for a key to rise back. A press is instant; the return is what you
 *  actually see, and too slow reads as mushy. */
const RETURN = 0.1;

const CELL_W = 128;
const CELL_H = 88;

/**
 * Key legends, as one atlas. Unlabelled keys are the single biggest tell that
 * a keypad is fake.
 *
 * Returns null without a DOM, so the geometry stays testable in Node. Labels
 * are decoration: nothing structural depends on them.
 */
function makeLabelAtlas(): Texture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = CELL_W * 4;
  canvas.height = CELL_H * 4;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  LAYOUT.forEach((row, r) => {
    row.forEach((key, c) => {
      const cx = c * CELL_W + CELL_W / 2;
      const cy = r * CELL_H + CELL_H / 2;
      ctx.save();
      ctx.translate(cx, cy);

      if (key.role === "digit") {
        const sub = SUBLABEL[key.label];
        ctx.fillStyle = "#e9ebee";
        ctx.font = `600 ${sub ? 40 : 34}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillText(key.label, 0, sub ? -8 : 0);
        if (sub) {
          ctx.fillStyle = "#9aa0a6";
          ctx.font = "600 17px ui-sans-serif, system-ui, sans-serif";
          ctx.fillText(sub, 0, 20);
        }
      } else {
        // Function glyphs are drawn rather than typed, so they do not depend
        // on a font having the right symbol.
        ctx.strokeStyle = key.role === "menu" ? "#3c4044" : "#ffffff";
        ctx.fillStyle = ctx.strokeStyle;
        ctx.lineWidth = 5;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        if (key.role === "cancel") {
          ctx.beginPath();
          ctx.moveTo(-13, -13);
          ctx.lineTo(13, 13);
          ctx.moveTo(13, -13);
          ctx.lineTo(-13, 13);
          ctx.stroke();
        } else if (key.role === "correct") {
          ctx.beginPath();
          ctx.moveTo(16, 0);
          ctx.lineTo(-14, 0);
          ctx.moveTo(-4, -10);
          ctx.lineTo(-15, 0);
          ctx.lineTo(-4, 10);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, 12, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();
    });
  });

  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function keyMaterials(): Record<KeyRole, MeshPhysicalMaterial> {
  // Satin, not gloss. Real terminal keys are moulded ABS that has been
  // handled a thousand times; a wet-looking highlight is what reads as toy.
  return {
    digit: new MeshPhysicalMaterial({
      color: 0x303338,
      roughness: 0.62,
      clearcoat: 0.18,
      clearcoatRoughness: 0.6,
    }),
    menu: new MeshPhysicalMaterial({ color: 0x8c9196, roughness: 0.55, metalness: 0.15 }),
    cancel: new MeshPhysicalMaterial({ color: 0x9e2a2a, roughness: 0.58, clearcoat: 0.2 }),
    correct: new MeshPhysicalMaterial({ color: 0xb8891a, roughness: 0.58, clearcoat: 0.2 }),
    enter: new MeshPhysicalMaterial({ color: 0x1f7a3d, roughness: 0.58, clearcoat: 0.2 }),
  };
}

export function createKeypad(o: KeypadOptions): Keypad {
  const group = new Group();
  group.name = "keypad";

  const pitchX = o.keyWidth + o.keyGap;
  const pitchZ = o.keyDepth + o.keyGap;
  const gridW = 4 * o.keyWidth + 3 * o.keyGap;
  const gridD = 4 * o.keyDepth + 3 * o.keyGap;

  // A dark plate under the keys. Without it the keys float on the shell and
  // the gaps between them read as nothing; with it they sit in a field.
  const wellMat = new MeshPhysicalMaterial({ color: 0x08090b, roughness: 0.95 });
  const well = new Mesh(
    new RoundedBoxGeometry(gridW + 0.005, 0.0014, gridD + 0.005, 3, 0.0014),
    wellMat,
  );
  well.name = "keyWell";
  well.position.set(0, o.surfaceY + 0.0004, o.centreZ);
  group.add(well);

  const wellTop = o.surfaceY + 0.0011;
  const restY = wellTop + o.keyHeight / 2;

  const keys: TerminalKey[] = [];
  LAYOUT.forEach((row, r) => {
    row.forEach((key, c) => {
      keys.push({
        position: new Vector3(
          (c - (row.length - 1) / 2) * pitchX,
          restY,
          o.centreZ + (r - (LAYOUT.length - 1) / 2) * pitchZ,
        ),
        label: key.label,
        role: key.role,
      });
    });
  });

  const materials = keyMaterials();
  const meshes: InstancedMesh[] = [];
  const slots = new Map<InstancedMesh, number[]>();
  const placement: { mesh: InstancedMesh; slot: number }[] = new Array(keys.length);

  const byRole = new Map<KeyRole, number[]>();
  keys.forEach((k, i) => {
    const list = byRole.get(k.role) ?? [];
    list.push(i);
    byRole.set(k.role, list);
  });

  const keyGeometry = new RoundedBoxGeometry(o.keyWidth, o.keyHeight, o.keyDepth, 3, 0.0008);
  for (const [role, indices] of byRole) {
    const mesh = new InstancedMesh(keyGeometry, materials[role], indices.length);
    mesh.name = `keys:${role}`;
    indices.forEach((keyIndex, slot) => {
      placement[keyIndex] = { mesh, slot };
      const list = slots.get(mesh) ?? [];
      list[slot] = keyIndex;
      slots.set(mesh, list);
    });
    meshes.push(mesh);
    group.add(mesh);
  }

  // --- legends --------------------------------------------------------------

  const atlas = makeLabelAtlas();
  const labelGeometry = new PlaneGeometry(o.keyWidth * 0.88, o.keyDepth * 0.88);
  const labels: (Mesh | null)[] = new Array(keys.length).fill(null);
  const labelTextures: Texture[] = [];
  const labelMaterials: Material[] = [];

  if (atlas) {
    LAYOUT.forEach((row, r) => {
      row.forEach((_key, c) => {
        const index = r * row.length + c;
        // One atlas, one clone per key: clones share the image, and only the
        // offset differs.
        const tex = atlas.clone();
        tex.needsUpdate = true;
        tex.repeat.set(1 / 4, 1 / 4);
        tex.offset.set(c / 4, 1 - (r + 1) / 4);
        labelTextures.push(tex);

        const mat = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
        labelMaterials.push(mat);

        const mesh = new Mesh(labelGeometry, mat);
        mesh.name = `label:${index}`;
        mesh.rotation.x = -Math.PI / 2;
        labels[index] = mesh;
        group.add(mesh);
      });
    });
  }

  const depth = new Float32Array(keys.length);
  const matrix = new Matrix4();

  function write(index: number): void {
    const where = placement[index]!;
    const key = keys[index]!;
    const y = key.position.y - depth[index]! * TRAVEL;
    matrix.makeTranslation(key.position.x, y, key.position.z);
    where.mesh.setMatrixAt(where.slot, matrix);
    where.mesh.instanceMatrix.needsUpdate = true;
    const label = labels[index];
    if (label) label.position.set(key.position.x, y + o.keyHeight / 2 + 0.00012, key.position.z);
  }

  for (let i = 0; i < keys.length; i++) write(i);

  return {
    group,
    keys,
    meshes,

    indexAt(object: Object3D, instanceId?: number): number {
      if (instanceId === undefined) return -1;
      const list = slots.get(object as InstancedMesh);
      return list?.[instanceId] ?? -1;
    },

    press(index: number): void {
      if (index < 0 || index >= keys.length) return;
      depth[index] = 1;
      write(index);
    },

    update(dt: number): void {
      for (let i = 0; i < keys.length; i++) {
        if (depth[i]! <= 0) continue;
        depth[i] = Math.max(0, depth[i]! - dt / RETURN);
        write(i);
      }
    },

    dispose(): void {
      const geometries = new Set<BufferGeometry>([keyGeometry, labelGeometry, well.geometry]);
      const mats = new Set<Material>([wellMat, ...labelMaterials]);
      for (const m of meshes) mats.add(m.material as Material);
      for (const g of geometries) g.dispose();
      for (const m of mats) m.dispose();
      for (const t of labelTextures) t.dispose();
      atlas?.dispose();
    },
  };
}
