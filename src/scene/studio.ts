import {
  AmbientLight, DataTexture, DirectionalLight, FloatType,
  type Object3D, PerspectiveCamera, RGBAFormat,
} from "three";

export interface Studio {
  camera: PerspectiveCamera;
  lights: Object3D[];
  /** The main light, exposed so callers can give it a shadow camera sized to
   *  their own scene. */
  key: DirectionalLight;
  rim: DirectionalLight;
  environment: DataTexture;
}

/**
 * Adds a soft elliptical source, wrapping in azimuth. Values go above 1: a
 * real environment has sources far brighter than white, and clamping them is
 * what makes specular highlights look like grey smudges.
 */
function addSource(
  data: Float32Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  intensity: number,
  tint: readonly [number, number, number],
): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Azimuth wraps, so the shortest distance may cross the seam.
      const raw = Math.abs(x - cx);
      const dx = Math.min(raw, w - raw) / rx;
      const dy = (y - cy) / ry;
      const d2 = dx * dx + dy * dy;
      if (d2 >= 1) continue;
      const falloff = (1 - d2) ** 2;
      const i = (y * w + x) * 4;
      data[i] = data[i]! + intensity * falloff * tint[0];
      data[i + 1] = data[i + 1]! + intensity * falloff * tint[1];
      data[i + 2] = data[i + 2]! + intensity * falloff * tint[2];
    }
  }
}

/**
 * A small equirectangular studio: a sky gradient with two softboxes and a
 * bounce. No HDRI to ship, but enough structure that glossy surfaces reflect
 * something with an edge to it rather than a uniform haze.
 *
 * PMREM conversion needs a live renderer, so that happens in the stage and
 * this stays headlessly testable.
 */
function studioEnvironment(w = 128, h = 64): DataTexture {
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    // Darker toward the floor, so there is a horizon for edges to catch.
    const t = y / (h - 1);
    const v = 0.012 + (1 - t) ** 1.6 * 0.1;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = v;
      data[i + 1] = v * 0.98;
      data[i + 2] = v * 0.95;
      data[i + 3] = 1;
    }
  }

  // Large warm key softbox, high and to the left of frame.
  addSource(data, w, h, w * 0.3, h * 0.2, w * 0.17, h * 0.17, 3.4, [1, 0.96, 0.9]);
  // Narrow cool strip behind, for the long highlight down the crown.
  addSource(data, w, h, w * 0.82, h * 0.26, w * 0.05, h * 0.2, 2.2, [0.86, 0.92, 1]);
  // Dim floor bounce, so the underside is not black.
  addSource(data, w, h, w * 0.45, h * 0.84, w * 0.3, h * 0.14, 0.35, [0.95, 0.95, 1]);

  const t = new DataTexture(data, w, h, RGBAFormat, FloatType);
  t.needsUpdate = true;
  return t;
}

export function createStudio(aspect: number): Studio {
  const camera = new PerspectiveCamera(32, aspect, 0.01, 10);
  camera.position.set(0.04, -0.18, 0.42);
  camera.lookAt(0.04, -0.18, 0);

  const key = new DirectionalLight(0xfff6ea, 3.2);
  key.position.set(-0.3, 0.4, 0.5);
  const rim = new DirectionalLight(0xdfe8ff, 1.6);
  rim.position.set(0.5, -0.1, -0.45);
  const fill = new AmbientLight(0x404858, 0.35);

  return { camera, lights: [key, rim, fill], key, rim, environment: studioEnvironment() };
}

/**
 * Points the key light at a scene of the given radius and sizes its shadow
 * camera to match.
 *
 * A directional light's default shadow frustum spans ten metres. Over a
 * 185mm object that puts a handful of shadow texels on the whole machine, so
 * the contact shadow comes out as a blocky smear — which reads as worse than
 * no shadow at all.
 */
export function enableShadows(studio: Studio, radius: number, target = { x: 0, y: 0, z: 0 }): void {
  const { key } = studio;
  key.castShadow = true;
  key.position.set(target.x - radius * 1.1, target.y + radius * 1.8, target.z + radius * 1.5);
  key.target.position.set(target.x, target.y, target.z);
  key.target.updateMatrixWorld();

  const cam = key.shadow.camera;
  cam.left = -radius * 1.6;
  cam.right = radius * 1.6;
  cam.top = radius * 1.6;
  cam.bottom = -radius * 1.6;
  cam.near = radius * 0.1;
  cam.far = radius * 8;
  cam.updateProjectionMatrix();

  key.shadow.mapSize.set(2048, 2048);
  // Tight geometry needs a small bias, or the object shadows itself in bands.
  key.shadow.bias = -0.00015;
  key.shadow.normalBias = radius * 0.01;
  key.shadow.radius = 3;
}
