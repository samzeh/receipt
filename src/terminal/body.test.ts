import { Box3, type BufferGeometry, type Material, Mesh, type Object3D } from "three";
import { describe, expect, it, vi } from "vitest";
import { createTerminalBody, RAMP_ANGLE, rampY, TERMINAL } from "./body";

function meshNamed(root: Object3D, name: string): Mesh {
  let found: Mesh | null = null;
  root.traverse((o) => {
    if (o instanceof Mesh && o.name === name) found = o;
  });
  if (!found) throw new Error(`no mesh named ${name}`);
  return found;
}

describe("createTerminalBody", () => {
  it("is wider than the paper it has to carry", () => {
    const body = createTerminalBody();

    expect(TERMINAL.width).toBeGreaterThan(TERMINAL.paperWidth);
    expect(body.anchors.paperSlot.width).toBeGreaterThanOrEqual(TERMINAL.paperWidth);

    body.dispose();
  });

  it("sits on the ground, centred on x, at the stated footprint", () => {
    const body = createTerminalBody();

    const box = new Box3().setFromObject(body.group);
    expect(box.min.y).toBeCloseTo(0, 3);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 3);
    expect(box.max.x - box.min.x).toBeCloseTo(TERMINAL.width, 2);
    expect(box.max.z - box.min.z).toBeCloseTo(TERMINAL.length, 2);

    body.dispose();
  });

  it("forms the printer crown as part of the shell, not a block stacked on it", () => {
    // A separate hump mesh is what made this read as a staircase. The crown
    // has to belong to the same continuous surface as the fascia.
    const body = createTerminalBody();

    const shell = new Box3().setFromObject(meshNamed(body.group, "shell"));
    expect(shell.max.y).toBeCloseTo(TERMINAL.crownTop, 2);
    expect(TERMINAL.crownTop).toBeGreaterThan(TERMINAL.keypadTop);

    body.dispose();
  });

  it("runs one continuous ramp from the keypad up to the crown", () => {
    // The grade is the defining surface. A flat fascia with a separate rise
    // behind it is the staircase; this is the thing that replaces it.
    expect(RAMP_ANGLE).toBeGreaterThan(0.2);
    expect(RAMP_ANGLE).toBeLessThan(0.45);

    // Height increases monotonically all the way up the ramp.
    let previous = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const z = TERMINAL.keypadBackZ + (TERMINAL.rampTopZ - TERMINAL.keypadBackZ) * (i / 20);
      const y = rampY(z);
      expect(y).toBeGreaterThan(previous);
      previous = y;
    }

    expect(rampY(TERMINAL.keypadBackZ)).toBeCloseTo(TERMINAL.keypadTop, 6);
    expect(rampY(TERMINAL.rampTopZ)).toBeCloseTo(TERMINAL.crownTop, 6);
  });

  it("lies the display on the ramp, tilted toward the user", () => {
    const body = createTerminalBody();

    const { position, tilt } = body.anchors.screen;
    expect(tilt).toBeCloseTo(RAMP_ANGLE, 9);
    // On the ramp surface, not floating above a flat shelf.
    expect(position.y).toBeCloseTo(rampY(position.z), 6);
    expect(position.y).toBeGreaterThan(TERMINAL.keypadTop);
    expect(position.z).toBeLessThan(TERMINAL.keypadBackZ);

    body.dispose();
  });

  it("carries the details the machine is recognisable by", () => {
    const body = createTerminalBody();

    const names = new Set<string>();
    body.group.traverse((o) => {
      if (o instanceof Mesh) names.add(o.name);
    });
    for (const part of [
      "shell", "paperSlot", "tearBar", "lidSeam", "cardSlot",
      "screen", "display", "grip:left", "grip:right",
    ]) {
      expect(names).toContain(part);
    }

    body.dispose();
  });

  it("emits paper from the crown, above the fascia", () => {
    const body = createTerminalBody();

    const { position, direction } = body.anchors.paperSlot;
    expect(position.y).toBeGreaterThan(TERMINAL.keypadTop);
    expect(position.z).toBeLessThan(TERMINAL.keypadBackZ);
    // Up and out, leaning toward the viewer.
    expect(direction.y).toBeGreaterThan(0.8);
    expect(direction.z).toBeGreaterThan(0);

    body.dispose();
  });

  it("puts the card slot on the chin, below the fascia", () => {
    const body = createTerminalBody();

    const { position, direction } = body.anchors.cardSlot;
    expect(position.z).toBeCloseTo(TERMINAL.length / 2, 3);
    expect(position.y).toBeLessThan(TERMINAL.chinTop);
    expect(direction.z).toBeLessThan(-0.5);

    body.dispose();
  });

  it("lays out a sixteen-key pad with a function column", () => {
    const body = createTerminalBody();

    const keys = body.anchors.keys;
    expect(keys).toHaveLength(16);
    const roles = keys.map((k) => k.role);
    expect(roles.filter((r) => r === "digit")).toHaveLength(12);
    for (const role of ["menu", "cancel", "correct", "enter"]) {
      expect(roles.filter((r) => r === role)).toHaveLength(1);
    }

    const fnX = keys.filter((k) => k.role !== "digit").map((k) => k.position.x.toFixed(5));
    expect(new Set(fnX).size).toBe(1);

    body.dispose();
  });

  it("keeps every key on the flat fascia, clear of the ramp", () => {
    const body = createTerminalBody();

    const screenFront = TERMINAL.screenZ + TERMINAL.glassLength / 2;
    for (const k of body.anchors.keys) {
      expect(k.position.y).toBeGreaterThan(TERMINAL.keypadTop);
      expect(k.position.z).toBeGreaterThan(screenFront);
      expect(k.position.z).toBeLessThan(TERMINAL.keypadFrontZ);
      expect(Math.abs(k.position.x)).toBeLessThan(TERMINAL.width / 2);
    }

    body.dispose();
  });

  it("disposes every geometry and material it created", () => {
    const body = createTerminalBody();

    // Counted per unique resource, not per mesh: the keypad deliberately
    // shares one geometry across its five colour meshes.
    const geometries = new Set<BufferGeometry>();
    const materials = new Set<Material>();
    body.group.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      geometries.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
    });
    const spies = [
      ...[...geometries].map((g) => vi.spyOn(g, "dispose")),
      ...[...materials].map((m) => vi.spyOn(m, "dispose")),
    ];

    body.dispose();

    expect(spies.length).toBeGreaterThan(0);
    for (const spy of spies) expect(spy).toHaveBeenCalled();
  });
});
