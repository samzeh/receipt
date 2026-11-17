import { Box3, Mesh, type Object3D } from "three";
import { describe, expect, it, vi } from "vitest";
import { CARD, createCard } from "./card";

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
