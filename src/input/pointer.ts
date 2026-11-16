import { Plane, Raycaster, Vector2, Vector3, type Camera, type Mesh } from "three";
import type { Cloth } from "../sim/Cloth";

export interface Pick {
  particle: number;
  point: Vector3;
}

export type Picker = (ndcX: number, ndcY: number) => Pick | null;

export interface PointerRig {
  pointerDown(ndcX: number, ndcY: number): void;
  pointerMove(ndcX: number, ndcY: number): void;
  pointerUp(): void;
  /** Call once per frame. */
  update(): void;
  readonly grabbing: boolean;
}

/** Raycasts the receipt and maps the hit to its nearest particle. */
export function meshPicker(mesh: Mesh, cloth: Cloth, camera: Camera): Picker {
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  return (x, y) => {
    ndc.set(x, y);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObject(mesh, false)[0];
    if (!hit) return null;
    const local = mesh.worldToLocal(hit.point.clone());
    return {
      particle: cloth.nearestParticle(local.x, local.y, local.z),
      point: hit.point.clone(),
    };
  };
}

/**
 * Picking is injected so this logic is testable without a renderer, and so the
 * raycast runs once per frame in `update()` rather than once per pointermove.
 *
 * Dragging unprojects the pointer onto the camera-parallel plane through the
 * original hit, which keeps the paper at a constant depth instead of swimming
 * toward the camera.
 */
export function createPointerRig(
  cloth: Cloth,
  camera: Camera,
  pick: Picker,
  /** World space to cloth space. The mesh usually sits under a transformed
   *  parent, and the solver only knows its own local coordinates. */
  toLocal: (v: Vector3) => Vector3 = (v) => v,
): PointerRig {
  const ndc = new Vector2();
  const plane = new Plane();
  const ray = new Raycaster();
  const hitPoint = new Vector3();
  const normal = new Vector3();
  const target = new Vector3();
  const local = new Vector3();
  let pendingPick = false;
  let grabbing = false;

  return {
    get grabbing() {
      return grabbing;
    },

    pointerDown(x, y) {
      ndc.set(x, y);
      pendingPick = true;
    },

    pointerMove(x, y) {
      ndc.set(x, y);
    },

    pointerUp() {
      grabbing = false;
      pendingPick = false;
      cloth.detach();
    },

    update() {
      if (pendingPick) {
        pendingPick = false;
        const hit = pick(ndc.x, ndc.y);
        if (hit) {
          grabbing = true;
          hitPoint.copy(hit.point);
          camera.getWorldDirection(normal);
          plane.setFromNormalAndCoplanarPoint(normal, hitPoint);
          local.copy(toLocal(hitPoint.clone()));
          cloth.attach(hit.particle, local.x, local.y, local.z);
        }
        return;
      }
      if (!grabbing) return;
      ray.setFromCamera(ndc, camera);
      if (ray.ray.intersectPlane(plane, target)) {
        local.copy(toLocal(target.clone()));
        cloth.moveAttachment(local.x, local.y, local.z);
      }
    },
  };
}
