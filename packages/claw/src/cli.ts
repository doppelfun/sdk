#!/usr/bin/env node
/**
 * CLI entrypoint for the Doppel claw agent.
 * Loads .env (repo root, cwd, then package dir), then runs the agent until exit.
 * Usage: pnpm run start | node dist/cli.js
 */

import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runAgent } from "./agent.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env in order: repo root (doppel-sdk/.env when run from packages/claw), cwd, package dir
config({ path: resolve(__dirname, "..", "..", "..", ".env") });
config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(__dirname, "..", ".env") });

runAgent({
  onConnected: (regionId, engineUrl) => {
    console.log("[agent] Connected — engine:", engineUrl, "region:", regionId);
    console.log("[agent] Open the space at this engine URL and join region", regionId, "to see the agent.");
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
