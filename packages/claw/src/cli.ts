#!/usr/bin/env node
/**
 * CLI entrypoint for the Doppel claw agent.
 */

import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runAgent } from "./lib/agent/agent.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(__dirname, "..", "..", "..", ".env") });
config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(__dirname, "..", ".env") });

runAgent({
  onConnected: (blockSlotId, engineUrl) => {
    console.log("[agent] Connected — engine:", engineUrl, "block slot:", blockSlotId);
    console.log("[agent] Open the block at this engine URL; block slot", blockSlotId, "to see the agent.");
  },
  onDisconnect: (err) => {
    console.error("[agent] Disconnected:", err?.message ?? "unknown");
  },
  onTick: (summary) => {
    console.log("[tick]", summary);
  },
  onToolCallResult: (name, args, result) => {
    console.log("[tool]", name, "args:", args, "->", result.ok ? result.summary ?? "ok" : result.error);
  },
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
