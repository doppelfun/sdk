/**
 * Fetch GLB(s), decode (including Draco), print world-space AABB dimensions.
 *
 * Usage:
 *   pnpm run analyze-model-dimensions -- https://.../Model.glb [url2 ...]
 *
 * Stdout: JSON map id → { width, depth, height }
 * Stderr: human-readable progress
 */
import { NodeIO } from "@gltf-transform/core";
import { KHRDracoMeshCompression } from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";
import { getModelDimensionsFromDocument } from "../src/model-dimensions.js";

const r3 = (n: number) => Math.round(n * 1000) / 1000;

type Entry = { id: string; url: string };

async function main() {
  const argv = process.argv.slice(2).filter((a) => a !== "--");
  if (argv.length === 0) {
    console.error("Usage: pnpm run analyze-model-dimensions -- <glb-url> [url2 ...]");
    process.exit(1);
  }
  const entries: Entry[] = argv.map((url, i) => ({ id: `url-${i}`, url }));

  const io = new NodeIO(fetch)
    .setAllowNetwork(true)
    .registerExtensions([KHRDracoMeshCompression])
    .registerDependencies({
      "draco3d.decoder": await draco3d.createDecoderModule(),
    });

  const results: Record<string, { width: number; depth: number; height: number }> = {};

  for (const entry of entries) {
    try {
      const doc = await io.read(entry.url);
      const dims = getModelDimensionsFromDocument(doc);
      if (dims) {
        results[entry.id] = {
          width: r3(dims.width),
          depth: r3(dims.depth),
          height: r3(dims.height),
        };
        console.error(
          `${entry.id}: ${dims.width.toFixed(2)} × ${dims.depth.toFixed(2)} × ${dims.height.toFixed(2)} (W×D×H)`,
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
