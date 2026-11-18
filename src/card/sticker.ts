import {
  CanvasTexture, LinearMipmapLinearFilter, type Material, Mesh, MeshPhysicalMaterial,
  PlaneGeometry, SRGBColorSpace, type Texture,
} from "three";

/**
 * Stickers: an image with a white die-cut border and a vinyl gloss.
 *
 * The border follows the image's alpha, not its bounding box, so a shaped
 * sticker gets a shaped outline. A fully opaque image traces its rectangle,
 * which is the same rule arriving at the same answer.
 *
 * The distance transform is pure and separate from the drawing, because it is
 * the part with an algorithm in it.
 */

/** A pixel is part of the sticker once its alpha passes this. */
const SOLID = 24;
/** Large enough to stand in for "unreachable" in the chamfer pass. */
const FAR = 1e9;

/**
 * Distance from every pixel to the nearest solid one, in pixels.
 *
 * A two-pass chamfer transform with 3 and 4 weights, divided back down by 3.
 * Approximate rather than exact Euclidean, by a few percent at the diagonals
 * — far below what a border a dozen pixels wide can show, and it runs in two
 * passes over the image instead of a search per pixel.
 */
export function distanceToSolid(alpha: Uint8Array, width: number, height: number): Float32Array {
  const dist = new Float32Array(width * height);
  for (let i = 0; i < dist.length; i++) dist[i] = alpha[i]! >= SOLID ? 0 : FAR;

  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= width || y >= height ? FAR : dist[y * width + x]!;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (dist[i] === 0) continue;
      dist[i] = Math.min(
        dist[i]!,
        at(x - 1, y) + 3,
        at(x, y - 1) + 3,
        at(x - 1, y - 1) + 4,
        at(x + 1, y - 1) + 4,
      );
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (dist[i] === 0) continue;
      dist[i] = Math.min(
        dist[i]!,
        at(x + 1, y) + 3,
        at(x, y + 1) + 3,
        at(x + 1, y + 1) + 4,
        at(x - 1, y + 1) + 4,
      );
    }
  }

  for (let i = 0; i < dist.length; i++) dist[i] = dist[i]! / 3;
  return dist;
}

/** Everything within `radius` of a solid pixel, including the solid ones. */
export function grownMask(
  alpha: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  const dist = distanceToSolid(alpha, width, height);
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = dist[i]! <= radius ? 255 : 0;
  return mask;
}

export interface StickerArt {
  texture: Texture;
  /** Width over height of the finished sticker, border included. */
  aspect: number;
}

export interface StickerLook {
  /**
   * White border, as a fraction of the sticker's longer side.
   *
   * A fraction rather than pixels: source images arrive at whatever size
   * they were exported at, and a border measured in their pixels comes out
   * thick on a small one and hairline on a large one.
   */
  border?: number;
  /** Soft shadow beyond the border, in the same units. */
  shadow?: number;
  /** Longest side of the canvas the sticker is composed on. */
  resolution?: number;
}

/**
 * Size to compose at: the source scaled down so its longer side is at most
 * `max`, never scaled up.
 *
 * A sticker covers a couple of centimetres of a card. Running a distance
 * transform over a three-megapixel export to produce it is work nobody sees.
 */
export function workingSize(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Composes the sticker: shadow, then white border, then the art on top.
 *
 * Returns null without a DOM, like the card's other generated textures.
 */
export function makeStickerArt(
  source: CanvasImageSource & { width: number; height: number },
  look: StickerLook = {},
): StickerArt | null {
  if (typeof document === "undefined") return null;
  const fit = workingSize(source.width, source.height, look.resolution ?? 512);
  const longest = Math.max(fit.width, fit.height);
  const border = Math.max(0, Math.round((look.border ?? 0.055) * longest));
  const shadow = Math.max(0, Math.round((look.shadow ?? 0.022) * longest));
  const pad = border + shadow + 2;

  const w = fit.width + pad * 2;
  const h = fit.height + pad * 2;

  // Read the art's alpha once, on its own padded canvas.
  const art = document.createElement("canvas");
  art.width = w;
  art.height = h;
  const artCtx = art.getContext("2d");
  if (!artCtx) return null;
  artCtx.drawImage(source, pad, pad, fit.width, fit.height);
  const alpha = new Uint8Array(w * h);
  const pixels = artCtx.getImageData(0, 0, w, h).data;
  for (let i = 0; i < alpha.length; i++) alpha[i] = pixels[i * 4 + 3]!;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const paint = (mask: Uint8Array, colour: [number, number, number, number]): void => {
    const image = ctx.createImageData(w, h);
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      image.data[i * 4] = colour[0];
      image.data[i * 4 + 1] = colour[1];
      image.data[i * 4 + 2] = colour[2];
      image.data[i * 4 + 3] = colour[3];
    }
    const layer = document.createElement("canvas");
    layer.width = w;
    layer.height = h;
    layer.getContext("2d")?.putImageData(image, 0, 0);
    ctx.drawImage(layer, 0, 0);
  };

  if (shadow > 0) {
    // Drawn blurred and offset, so the sticker sits above the card rather
    // than being printed into it.
    ctx.save();
    ctx.filter = `blur(${Math.max(1, Math.round(shadow * 0.6))}px)`;
    ctx.translate(0, shadow * 0.45);
    paint(grownMask(alpha, w, h, border + shadow * 0.6), [12, 18, 24, 90]);
    ctx.restore();
  }
  paint(grownMask(alpha, w, h, border), [255, 255, 255, 255]);
  ctx.drawImage(art, 0, 0);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return { texture, aspect: w / h };
}

export interface Sticker {
  mesh: Mesh;
  dispose(): void;
}

export interface StickerOptions extends StickerLook {
  /** Width on the card, in metres, border included. */
  width: number;
  /** Tilt, in radians. Stickers are never applied straight. */
  rotation?: number;
}

export function createSticker(
  source: CanvasImageSource & { width: number; height: number },
  options: StickerOptions,
): Sticker | null {
  const art = makeStickerArt(source, options);
  if (!art) return null;

  // Matte vinyl, no laminate.
  //
  // A clearcoat is a second, much sharper specular layer sitting over the
  // print, and at this angle it reflects the softboxes straight back at the
  // camera — the art disappears under a white sheet exactly when you are
  // looking at it head on. Roughness on the base layer cannot reach it,
  // because it is a separate lobe. The only fix is not to have one.
  const material = new MeshPhysicalMaterial({
    map: art.texture,
    transparent: true,
    alphaTest: 0.35,
    roughness: 0.68,
    metalness: 0,
    clearcoat: 0.3,
    envMapIntensity: 0.5,
  });

  const geometry = new PlaneGeometry(options.width, options.width / art.aspect);
  const mesh = new Mesh(geometry, material);
  mesh.name = "sticker";
  mesh.rotation.z = options.rotation ?? 0;

  return {
    mesh,
    dispose(): void {
      geometry.dispose();
      art.texture.dispose();
      (material as Material).dispose();
    },
  };
}
