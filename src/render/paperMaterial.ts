import {
  DataTexture, DoubleSide, LinearFilter, MeshPhysicalMaterial,
  RepeatWrapping, RGBAFormat, type Texture,
} from "three";
import { mulberry32 } from "../text/rng";

/** Paper fibre, baked once at init. Grain runs along the roll, so X jitters
 *  more than Y. */
export function makeFibreNormalMap(size = 256): DataTexture {
  const data = new Uint8Array(size * size * 4);
  const rand = mulberry32(0xf1b3);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = 128 + Math.round((rand() - 0.5) * 36);
    data[i * 4 + 1] = 128 + Math.round((rand() - 0.5) * 14);
    data[i * 4 + 2] = 250;
    data[i * 4 + 3] = 255;
  }
  const t = new DataTexture(data, size, size, RGBAFormat);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.repeat.set(6, 48);
  t.needsUpdate = true;
  return t;
}

/**
 * Translucency is the primary realism cue: a receipt lit from behind glows and
 * shows its print through the back. Thickness is the real 0.08mm in world
 * metres. The ink mask drives roughness because thermal print is marginally
 * glossier than bare stock.
 */
export function createPaperMaterial(albedo: Texture, inkMask: Texture): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    map: albedo,
    roughnessMap: inkMask,
    normalMap: makeFibreNormalMap(),
    side: DoubleSide,
    // Cuts the torn ends out of the rectangle mesh.
    alphaTest: 0.5,
    roughness: 0.85,
    metalness: 0,
    transmission: 0.35,
    thickness: 8e-5,
    ior: 1.5,
    sheen: 0.35,
    sheenRoughness: 0.8,
  });
}
