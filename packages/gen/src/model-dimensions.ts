/**
 * Compute axis-aligned bounding box (AABB) dimensions from a glTF-Transform Document.
 *
 * Traverses the scene graph, accumulating node TRS so models with root scale (e.g. 0.01)
 * report true world-space width/depth/height.
 *
 * Use with NodeIO.read(url) or io.readBinary(buffer) after registering Draco if needed.
 */

import type { Document, Node } from "@gltf-transform/core";

export type ModelDimensions = {
  /** X extent (left-right) */
  width: number;
  /** Z extent (front-back) */
  depth: number;
  /** Y extent (bottom-top) */
  height: number;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

type Mat4 = Float64Array;

function mat4Identity(): Mat4 {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

function mat4FromTRS(t: number[], r: number[], s: number[]): Mat4 {
  const [qx, qy, qz, qw] = r;
  const xx = qx * qx,
    yy = qy * qy,
    zz = qz * qz;
  const xy = qx * qy,
    xz = qx * qz,
    yz = qy * qz;
  const wx = qw * qx,
    wy = qw * qy,
    wz = qw * qz;

  const m = new Float64Array(16);
  m[0] = (1 - 2 * (yy + zz)) * s[0];
  m[1] = 2 * (xy + wz) * s[0];
  m[2] = 2 * (xz - wy) * s[0];
  m[4] = 2 * (xy - wz) * s[1];
  m[5] = (1 - 2 * (xx + zz)) * s[1];
  m[6] = 2 * (yz + wx) * s[1];
  m[8] = 2 * (xz + wy) * s[2];
  m[9] = 2 * (yz - wx) * s[2];
  m[10] = (1 - 2 * (xx + yy)) * s[2];
  m[12] = t[0];
  m[13] = t[1];
  m[14] = t[2];
  m[15] = 1;
  return m;
}

function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const o = new Float64Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      o[col * 4 + row] =
        a[row] * b[col * 4] +
        a[4 + row] * b[col * 4 + 1] +
        a[8 + row] * b[col * 4 + 2] +
        a[12 + row] * b[col * 4 + 3];
    }
  }
  return o;
}

function mat4TransformPoint(m: Mat4, p: number[]): [number, number, number] {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

function getWorldMatrix(node: Node): Mat4 {
  const chain: Node[] = [];
  let cur: Node | null = node;
  while (cur) {
    chain.push(cur);
    cur = cur.getParentNode();
  }
  let world = mat4Identity();
  for (let i = chain.length - 1; i >= 0; i--) {
    const n = chain[i]!;
    const local = mat4FromTRS(
      n.getTranslation() as number[],
      n.getRotation() as number[],
      n.getScale() as number[],
    );
    world = mat4Multiply(world, local);
  }
  return world;
}

/**
 * World-space AABB across every mesh primitive, accounting for node transforms.
 * Returns null when no POSITION attributes are found.
 */
export function getModelDimensionsFromDocument(doc: Document): ModelDimensions | null {
  const globalMin = [Infinity, Infinity, Infinity];
  const globalMax = [-Infinity, -Infinity, -Infinity];
  let found = false;

  const primMin = [0, 0, 0];
  const primMax = [0, 0, 0];

  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;

    const world = getWorldMatrix(node);

    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute("POSITION");
      if (!position) continue;

      position.getMin(primMin);
      position.getMax(primMax);
      if (!Number.isFinite(primMin[0]) || !Number.isFinite(primMax[0])) continue;

      for (let cx = 0; cx < 2; cx++) {
        for (let cy = 0; cy < 2; cy++) {
          for (let cz = 0; cz < 2; cz++) {
            const corner = mat4TransformPoint(world, [
              cx === 0 ? primMin[0] : primMax[0],
              cy === 0 ? primMin[1] : primMax[1],
              cz === 0 ? primMin[2] : primMax[2],
            ]);
            for (let i = 0; i < 3; i++) {
              globalMin[i] = Math.min(globalMin[i], corner[i]);
              globalMax[i] = Math.max(globalMax[i], corner[i]);
            }
            found = true;
          }
        }
      }
    }
  }

  if (!found) return null;

  return {
    minX: globalMin[0],
    minY: globalMin[1],
    minZ: globalMin[2],
    maxX: globalMax[0],
    maxY: globalMax[1],
    maxZ: globalMax[2],
    width: globalMax[0] - globalMin[0],
    depth: globalMax[2] - globalMin[2],
    height: globalMax[1] - globalMin[1],
  };
}

/**
 * Geometry centre offsets from model origin in X/Z (metres), matching seed-buildings
 * convention: originOffsetX = (minX+maxX)/2, originOffsetZ = (minZ+maxZ)/2 when origin is at corner.
 * Useful for updating DEFAULT_SEED_BUILDING_DIMENSIONS after re-analysing a GLB.
 */
export function dimensionsToOriginOffsets(d: ModelDimensions): {
  originOffsetX: number;
  originOffsetZ: number;
} {
  return {
    originOffsetX: (d.minX + d.maxX) / 2,
    originOffsetZ: (d.minZ + d.maxZ) / 2,
  };
}
