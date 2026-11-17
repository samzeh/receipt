import {
  AmbientLight, DataTexture, DirectionalLight, FloatType,
  type Object3D, PerspectiveCamera, RGBAFormat,
} from "three";

/**
 * "dark" is the receipt's void: a near-black room where a translucent sheet
 * glows. "light" is a product sweep for objects shot on an off-white
 * backdrop, where the background itself is most of the light.
 */
export type StudioMode = "dark" | "light";

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
/**
 * A rectangular panel with a soft edge, which is what a softbox actually is.
 * Ellipses with a quadratic falloff smear into the sky; a mirror needs an
 * edge to reflect.
 */
function addPanel(
  data: Float32Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  intensity: number,
  tint: readonly [number, number, number],
  softness = 0.3,
): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const raw = Math.abs(x - cx);
      const dx = Math.min(raw, w - raw) / rx;
      const dy = (y - cy) / ry;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      if (d >= 1) continue;
      const edge = d < 1 - softness ? 1 : (1 - d) / softness;
      const f = edge * edge * (3 - 2 * edge);
      const i = (y * w + x) * 4;
      data[i] = data[i]! + intensity * f * tint[0];
      data[i + 1] = data[i + 1]! + intensity * f * tint[1];
      data[i + 2] = data[i + 2]! + intensity * f * tint[2];
    }
  }
}

/** Scales a wedge of azimuth, for carving darkness into a bright room. */
function darken(
  data: Float32Array,
  w: number,
  h: number,
  cx: number,
  rx: number,
  factor: number,
): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const raw = Math.abs(x - cx);
      const d = Math.min(raw, w - raw) / rx;
      if (d >= 1) continue;
      const t = 1 - d * d;
      const k = 1 - (1 - factor) * t * t;
      const i = (y * w + x) * 4;
      data[i] = data[i]! * k;
      data[i + 1] = data[i + 1]! * k;
      data[i + 2] = data[i + 2]! * k;
    }
  }
}

function studioEnvironment(mode: StudioMode, w = 128, h = 64): DataTexture {
  const light = mode === "light";
  // The light room is bright on average but has real range. A polished
  // surface reflects the environment, so a dome that is uniformly near-white
  // renders a mirror as a flat grey card: it is the darks between the
  // softboxes that make a reflection read as a reflection.
  const sky = light ? 0.6 : 0.112;
  const floor = light ? 0.12 : 0.012;

  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1);
    const v = floor + (1 - t) ** 1.5 * (sky - floor);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = v;
      data[i + 1] = v * (light ? 0.995 : 0.98);
      data[i + 2] = v * (light ? 0.985 : 0.95);
      data[i + 3] = 1;
    }
  }

  if (light) {
    // The camera's side of the room is dark — there is no wall there, just
    // the lens. Without it a mirror has nothing dark to catch.
    darken(data, w, h, w * 0.0, w * 0.3, 0.1);
    darken(data, w, h, w * 0.52, w * 0.12, 0.35);

    // Softboxes bright enough to read as sources in a reflection, but not so
    // bright that a polished metal reflecting them clips to white and loses
    // every bit of detail it was carrying.
    addPanel(data, w, h, w * 0.26, h * 0.16, w * 0.16, h * 0.15, 5.5, [1, 0.98, 0.95], 0.22);
    // A tall strip to the side, for the long highlight that runs down an edge.
    addPanel(data, w, h, w * 0.72, h * 0.34, w * 0.045, h * 0.3, 3.2, [0.93, 0.96, 1], 0.25);
    // A second, smaller overhead box, so reflections have more than one shape.
    addPanel(data, w, h, w * 0.44, h * 0.1, w * 0.07, h * 0.08, 2.6, [1, 0.99, 0.97], 0.3);
    // Bright sweep below the horizon: the white floor the card sits over.
    addPanel(data, w, h, w * 0.3, h * 0.8, w * 0.42, h * 0.16, 0.8, [0.98, 0.98, 1], 0.6);
  } else {
    addSource(data, w, h, w * 0.3, h * 0.2, w * 0.17, h * 0.17, 3.4, [1, 0.96, 0.9]);
    addSource(data, w, h, w * 0.82, h * 0.26, w * 0.05, h * 0.2, 2.2, [0.86, 0.92, 1]);
    addSource(data, w, h, w * 0.45, h * 0.84, w * 0.3, h * 0.14, 0.35, [0.95, 0.95, 1]);
  }

  const t = new DataTexture(data, w, h, RGBAFormat, FloatType);
  t.needsUpdate = true;
  return t;
}

export function createStudio(aspect: number, mode: StudioMode = "dark"): Studio {
  const light = mode === "light";
  const camera = new PerspectiveCamera(32, aspect, 0.01, 10);
  camera.position.set(0.04, -0.18, 0.42);
  camera.lookAt(0.04, -0.18, 0);

  // In the light room the environment does essentially all the lighting. The
  // lamps only shape a highlight and give something to cast a shadow, and the
  // ambient is nearly off: an ambient light is a crude stand-in for an
  // environment, so running both double-counts the same illumination and
  // flattens everything it touches.
  const key = new DirectionalLight(0xfff6ea, light ? 0.7 : 3.2);
  key.position.set(-0.3, 0.4, 0.5);
  const rim = new DirectionalLight(0xdfe8ff, light ? 0.28 : 1.6);
  rim.position.set(0.5, -0.1, -0.45);
  const fill = new AmbientLight(light ? 0xdfe3ea : 0x404858, light ? 0.06 : 0.35);

  return { camera, lights: [key, rim, fill], key, rim, environment: studioEnvironment(mode) };
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
