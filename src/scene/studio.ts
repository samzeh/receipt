import {
  AmbientLight, DataTexture, DirectionalLight, FloatType,
  PerspectiveCamera, RGBAFormat, type Object3D,
} from "three";

export interface Studio {
  camera: PerspectiveCamera;
  lights: Object3D[];
  environment: DataTexture;
}

/** A dim equirectangular gradient — just enough environment for specular,
 *  with no HDRI to ship. PMREM conversion needs a live renderer, so that
 *  happens in Receipt and this stays headlessly testable. */
function gradientEnvironment(w = 32, h = 16): DataTexture {
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const v = 0.015 + (1 - y / (h - 1)) * 0.12;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = v;
      data[i + 1] = v * 0.98;
      data[i + 2] = v * 0.94;
      data[i + 3] = 1;
    }
  }
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

  return { camera, lights: [key, rim, fill], environment: gradientEnvironment() };
}
