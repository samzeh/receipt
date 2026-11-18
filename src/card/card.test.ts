import { Box3, Mesh, type MeshPhysicalMaterial, type Object3D } from "three";
import { describe, expect, it, vi } from "vitest";
import {
  CARD, CLOUD_SHAPE, cloudRuns, createCard, NAME_INK, pixelHorizon, valueNoise,
} from "./card";
import { CHARACTER_PALETTE, CHARACTER_PIXELS } from "./character";

function meshNamed(root: Object3D, name: string): Mesh {
  let found: Mesh | null = null;
  root.traverse((o) => {
    if (o instanceof Mesh && o.name === name) found = o;
  });
  if (!found) throw new Error(`no mesh named ${name}`);
  return found;
}

describe("createCard", () => {
  it("is an ID-1 card", () => {
    // 85.6 x 53.98mm is the rectangle every card in a wallet is; getting it
    // wrong is invisible alone and obvious next to a card slot.
    const card = createCard();

    const box = new Box3().setFromObject(meshNamed(card.group, "body"));
    expect(box.max.x - box.min.x).toBeCloseTo(CARD.width, 4);
    expect(box.max.y - box.min.y).toBeCloseTo(CARD.height, 4);
    expect(box.max.z - box.min.z).toBeCloseTo(CARD.thickness, 4);

    card.dispose();
  });

  it("is centred on the origin, facing +z", () => {
    const card = createCard();

    const box = new Box3().setFromObject(meshNamed(card.group, "body"));
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 5);
    expect((box.min.y + box.max.y) / 2).toBeCloseTo(0, 5);
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 5);
    expect(card.anchors.face.z).toBe(1);

    card.dispose();
  });

  it("keeps the card thinner than it is wide by a wide margin", () => {
    // A card that renders as a slab is the fastest way to lose the illusion.
    expect(CARD.thickness).toBeLessThan(CARD.width / 50);
  });

  it("maps UVs across the whole face, not in world units", () => {
    // ExtrudeGeometry's default UVs are in metres, so over a 12mm chip every
    // sample lands in one corner of the texture: the chip renders flat gold
    // and the brushed metal renders smooth. Nothing errors, the maps just
    // never show up.
    const card = createCard();

    for (const name of ["body", "chip"]) {
      const uv = meshNamed(card.group, name).geometry.getAttribute("uv");
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < uv.count; i++) {
        min = Math.min(min, uv.getX(i), uv.getY(i));
        max = Math.max(max, uv.getX(i), uv.getY(i));
      }
      expect(min).toBeCloseTo(0, 2);
      expect(max).toBeCloseTo(1, 2);
    }

    card.dispose();
  });

  it("sets the chip right of centre and below the midline", () => {
    const card = createCard();

    expect(card.anchors.chip.x).toBeGreaterThan(0);
    expect(card.anchors.chip.y).toBeLessThan(0);

    card.dispose();
  });

  it("keeps the chip close to square, as a modern contact plate is", () => {
    const ratio = CARD.chipWidth / CARD.chipHeight;
    expect(ratio).toBeGreaterThan(0.95);
    expect(ratio).toBeLessThan(1.3);
  });

  it("keeps the whole chip on the card", () => {
    const card = createCard();

    const chip = new Box3().setFromObject(meshNamed(card.group, "chip"));
    const body = new Box3().setFromObject(meshNamed(card.group, "body"));
    expect(chip.min.x).toBeGreaterThan(body.min.x);
    expect(chip.max.x).toBeLessThan(body.max.x);
    expect(chip.min.y).toBeGreaterThan(body.min.y);
    expect(chip.max.y).toBeLessThan(body.max.y);

    card.dispose();
  });

  it("stands the chip proud of the card face rather than sunk into it", () => {
    const card = createCard();

    const chip = new Box3().setFromObject(meshNamed(card.group, "chip"));
    expect(chip.max.z).toBeGreaterThan(CARD.thickness / 2);
    // Proud, but only just: a chip that stands off the card reads as a sticker.
    expect(chip.max.z - CARD.thickness / 2).toBeLessThan(0.0004);

    card.dispose();
  });

  it("leads with the edge nearest the chip when inserted", () => {
    const card = createCard();

    expect(Math.sign(card.anchors.insertEdge.x)).toBe(Math.sign(card.anchors.chip.x));
    expect(Math.abs(card.anchors.insertEdge.x)).toBeCloseTo(CARD.width / 2, 5);

    card.dispose();
  });

  it("cuts the horizon into flat runs, not a per-column staircase", () => {
    // Steps are the whole look. A height that changes every column reads as a
    // jagged line, not as pixel art.
    const profile = pixelHorizon(112, 70, {
      base: 0.58,
      rise: 0.2,
      step: 4,
      jitter: 1,
      seed: 0x51a2,
    });

    let changes = 0;
    for (let i = 1; i < profile.length; i++) {
      if (profile[i] !== profile[i - 1]) changes += 1;
    }

    // Far fewer transitions than columns means genuine blocks.
    expect(changes).toBeGreaterThan(4);
    expect(changes).toBeLessThan(profile.length / 3);
  });

  it("puts the valley in the middle and the hills at the edges", () => {
    const rows = 70;
    const profile = pixelHorizon(112, rows, {
      base: 0.58,
      rise: 0.2,
      step: 4,
      jitter: 0,
      seed: 0x51a2,
    });

    const middle = profile[Math.floor(profile.length / 2)]!;
    // Row 0 is the top, so a larger row index means lower on the card.
    expect(middle).toBeGreaterThan(profile[0]!);
    expect(middle).toBeGreaterThan(profile[profile.length - 1]!);
    for (const row of profile) {
      expect(row).toBeGreaterThanOrEqual(0);
      expect(row).toBeLessThanOrEqual(rows);
    }
  });

  it("builds clouds that are widest through the middle of the stack", () => {
    // Stacked bars of equal width read as a brick. The taper is the cloud.
    const runs = cloudRuns(24, 0x3f21);

    expect(runs).toHaveLength(CLOUD_SHAPE.length);
    const widest = runs.reduce((a, b) => (b.width > a.width ? b : a));
    expect(widest.y).toBeGreaterThan(0);
    expect(widest.y).toBeLessThan(runs.length - 1);
  });

  it("keeps clouds far wider than they are tall", () => {
    // The reference clouds are flat streaks. A cloud as tall as it is wide
    // reads as a lump sitting in the sky rather than drifting across it.
    const runs = cloudRuns(24, 0x3f21);
    const widest = runs.reduce((a, b) => (b.width > a.width ? b : a));

    expect(widest.width / runs.length).toBeGreaterThan(3);
  });

  it("starts a cloud with a narrow bar above its body", () => {
    const runs = cloudRuns(24, 0x8ad4);

    expect(runs[0]!.width).toBeLessThan(runs[2]!.width * 0.6);
  });

  it("keeps every cloud run inside its own width", () => {
    for (const seed of [0x3f21, 0x8ad4, 0x16bc]) {
      for (const run of cloudRuns(24, seed)) {
        expect(run.x).toBeGreaterThanOrEqual(0);
        expect(run.width).toBeGreaterThanOrEqual(2);
        expect(run.x + run.width).toBeLessThanOrEqual(24);
      }
    }
  });

  it("keeps the character sprite rectangular and inside its palette", () => {
    // Generated from the source artwork, but a regeneration that went wrong
    // would shear the figure or index colours that do not exist, and both
    // fail silently at draw time.
    const width = CHARACTER_PIXELS[0]!.length;
    expect(width).toBeGreaterThan(16);
    expect(CHARACTER_PIXELS.length).toBeGreaterThan(width);
    for (const row of CHARACTER_PIXELS) expect(row).toHaveLength(width);

    const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
    for (const row of CHARACTER_PIXELS) {
      for (const ch of row) {
        if (ch === ".") continue;
        const index = chars.indexOf(ch);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(CHARACTER_PALETTE[index]).toBeDefined();
      }
    }
  });

  it("uses every colour it declares", () => {
    const used = new Set<string>();
    for (const row of CHARACTER_PIXELS) {
      for (const ch of row) if (ch !== ".") used.add(ch);
    }
    expect(used.size).toBe(CHARACTER_PALETTE.length);
    for (const hex of CHARACTER_PALETTE) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("prints a different face on the back than the front", () => {
    const card = createCard();

    const front = meshNamed(card.group, "front").material as MeshPhysicalMaterial;
    const back = meshNamed(card.group, "back").material as MeshPhysicalMaterial;

    // Separate materials on separate meshes is the fix; sharing one is what
    // put the front's artwork on the back. Their maps cannot be compared
    // here — with no DOM the art is never generated and both are null — so
    // this checks identity and the colours they fall back to.
    expect(front).not.toBe(back);
    expect(front.color.getHex()).not.toBe(back.color.getHex());

    card.dispose();
  });

  it("keeps the printed faces inside the card's outline", () => {
    // The extruded substrate's cap is narrower than its nominal width, so a
    // face cut to the full size overhangs the rounded edge and the artwork
    // appears to wrap around the side of the card.
    const card = createCard();

    const body = new Box3().setFromObject(meshNamed(card.group, "body"));
    for (const name of ["front", "back"]) {
      const plate = new Box3().setFromObject(meshNamed(card.group, name));
      expect(plate.min.x).toBeGreaterThan(body.min.x);
      expect(plate.max.x).toBeLessThan(body.max.x);
      expect(plate.min.y).toBeGreaterThan(body.min.y);
      expect(plate.max.y).toBeLessThan(body.max.y);
    }

    card.dispose();
  });

  it("keeps the printed faces outside the substrate, on both sides", () => {
    const card = createCard();

    const front = meshNamed(card.group, "front");
    const back = meshNamed(card.group, "back");
    expect(front.position.z).toBeGreaterThanOrEqual(CARD.thickness / 2);
    expect(back.position.z).toBeLessThanOrEqual(-CARD.thickness / 2);

    card.dispose();
  });

  it("keeps the name in caps", () => {
    expect(CARD.name).toBe(CARD.name.toUpperCase());
  });

  it("makes noise that tiles without a seam", () => {
    // These maps repeat across the card. A lattice that does not wrap puts a
    // visible line down it, which looks like a crease in the card.
    const size = 64;
    const noise = valueNoise(size, 8, 0x1234);
    for (let y = 0; y < size; y++) {
      const left = noise[y * size]!;
      const right = noise[y * size + size - 1]!;
      // Adjacent across the wrap, so they must be close, not equal.
      expect(Math.abs(left - right)).toBeLessThan(0.2);
    }
  });

  it("makes noise that is smooth, not static", () => {
    // White noise would alias into sparkle once the card is minified.
    const size = 64;
    const noise = valueNoise(size, 6, 0x4321);
    let worst = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 1; x < size; x++) {
        worst = Math.max(worst, Math.abs(noise[y * size + x]! - noise[y * size + x - 1]!));
      }
    }
    expect(worst).toBeLessThan(0.25);
  });

  it("keeps the noise inside its range and actually varying", () => {
    const noise = valueNoise(48, 5, 0x9999);
    let min = Infinity;
    let max = -Infinity;
    for (const v of noise) {
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(1);
    expect(max - min).toBeGreaterThan(0.4);
  });

  it("gives the printed face varying roughness and a grain", () => {
    // One roughness value across the whole card is what made it read as a
    // flat panel: light never falls unevenly on it.
    const card = createCard();
    const front = meshNamed(card.group, "front").material as MeshPhysicalMaterial;

    expect(front.roughnessMap).not.toBeNull();
    expect(front.normalMap).not.toBeNull();
    expect(front.normalScale.x).toBeGreaterThan(0.1);
    // But not so much that it smears the pixel art.
    expect(front.normalScale.x).toBeLessThan(0.5);

    card.dispose();
  });

  it("has a usable ink colour", () => {
    expect(NAME_INK).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("keeps the name inside the card", () => {
    // Only the edges are a rule. Whether it overlaps the character is a
    // placement decision, and it currently does — the name crosses the
    // figure's legs on purpose.
    const nameHeight = CARD.nameWidth / 4;
    const top = CARD.nameY + nameHeight / 2;
    const bottom = CARD.nameY - nameHeight / 2;

    expect(bottom).toBeGreaterThan(-CARD.height / 2 + 0.0005);
    expect(top).toBeLessThan(CARD.height / 2 - 0.0005);
    expect(CARD.nameX - CARD.nameWidth / 2).toBeGreaterThan(-CARD.width / 2 + 0.0005);
    expect(CARD.nameX + CARD.nameWidth / 2).toBeLessThan(CARD.width / 2 - 0.0005);
  });

  it("keeps the name part metal, not fully", () => {
    // At metalness 1 a tinted foil keeps its colour only in the reflection,
    // so the name goes dark whenever the card turns away from a light.
    // Holding some diffuse keeps it legible at every angle. How much is a
    // matter of taste and gets tuned; that it is neither extreme is not.
    const card = createCard();
    const name = meshNamed(card.group, "name").material as MeshPhysicalMaterial;

    expect(name.metalness).toBeGreaterThan(0);
    expect(name.metalness).toBeLessThan(1);

    card.dispose();
  });

  it("gives the name more sheen than the card itself has", () => {
    // It has to catch the light where the card around it does not, or it
    // reads as part of the artwork rather than as something applied to it.
    const card = createCard();
    const name = meshNamed(card.group, "name").material as MeshPhysicalMaterial;
    const front = meshNamed(card.group, "front").material as MeshPhysicalMaterial;

    expect(name.roughness).toBeLessThan(front.roughness);
    expect(name.metalness).toBeGreaterThan(front.metalness);

    card.dispose();
  });

  it("disposes every geometry and material it created", () => {
    const card = createCard();

    const spies: ReturnType<typeof vi.spyOn>[] = [];
    card.group.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      spies.push(vi.spyOn(o.geometry, "dispose"));
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        spies.push(vi.spyOn(m, "dispose"));
      }
    });

    card.dispose();

    expect(spies.length).toBeGreaterThan(0);
    for (const spy of spies) expect(spy).toHaveBeenCalled();
  });
});
