/**
 * Fetch GLB(s), decode (including Draco), print world-space AABB dimensions.
 *
 * Usage:
 *   pnpm run analyze-model-dimensions              # all SEED_BUILDINGS
 *   pnpm run analyze-model-dimensions -- https://.../Model.glb
 *
 * Stdout: JSON map id → { width, depth, height, originOffsetX, originOffsetZ }
 * Stderr: human-readable progress
 */
import { NodeIO } from "@gltf-transform/core";
import { KHRDracoMeshCompression } from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";
import {
  getModelDimensionsFromDocument,
  dimensionsToOriginOffsets,
} from "../src/model-dimensions.js";
import { SEED_BUILDINGS } from "../src/city/layout/seed-buildings.js";

const r3 = (n: number) => Math.round(n * 1000) / 1000;

type Entry = { id: string; url: string };

async function main() {
  const argv = process.argv.slice(2).filter((a) => a !== "--");
  const entries: Entry[] =
    argv.length > 0
      ? argv.map((url, i) => ({ id: `url-${i}`, url }))
      : SEED_BUILDINGS.map((b) => ({ id: b.id, url: b.url }));

  const io = new NodeIO(fetch)
    .setAllowNetwork(true)
    .registerExtensions([KHRDracoMeshCompression])
    .registerDependencies({
      "draco3d.decoder": await draco3d.createDecoderModule(),
    });

  const results: Record<
    string,
    { width: number; depth: number; height: number; originOffsetX: number; originOffsetZ: number }
  > = {};

  for (const entry of entries) {
    try {
      const doc = await io.read(entry.url);
      const dims = getModelDimensionsFromDocument(doc);
      if (dims) {
        const origin = dimensionsToOriginOffsets(dims);
        results[entry.id] = {
          width: r3(dims.width),
          depth: r3(dims.depth),
          height: r3(dims.height),
          originOffsetX: r3(origin.originOffsetX),
          originOffsetZ: r3(origin.originOffsetZ),
        };
        console.error(
          `${entry.id}: ${dims.width.toFixed(2)} × ${dims.depth.toFixed(2)} × ${dims.height.toFixed(2)} (W×D×H)  ` +
            `originOffsetX/Z ${origin.originOffsetX.toFixed(3)}, ${origin.originOffsetZ.toFixed(3)}`,
        );
      } else {
        console.error(`${entry.id}: no geometry found`);
      }
    } catch (err) {
      console.error(`${entry.id}: ERROR ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(JSON.stringify(results, null, 2));
}

main();
