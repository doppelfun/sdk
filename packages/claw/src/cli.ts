#!/usr/bin/env node
/**
 * CLI — run the wake-driven claw agent. Requires DOPPEL_AGENT_API_KEY and a block (BLOCK_ID or profile default).
 * Optional: dotenv to load .env; OPENROUTER_API_KEY for LLM.
 */
import { config as loadDotenv } from "dotenv";
import { resolve, dirname } from "node:path";
import WebSocket from "ws";
import { createClient } from "@doppelfun/sdk";
import {
  bootstrapAgent,
  createSession,
  getDefaultBlockId,
  createRunner,
  handleChatMessage,
  startCronScheduler,
} from "./index.js";

// Load .env from cwd, package dir, and parent dir (monorepo root when running from packages/claw)
const cwd = process.cwd();
loadDotenv({ path: resolve(cwd, ".env") });
loadDotenv({ path: resolve(cwd, "..", "..", ".env") });

async function main(): Promise<void> {
  const { config, profile } = await bootstrapAgent();
  const blockId = getDefaultBlockId(profile, config, "0_0");

  const session = await createSession(config, blockId, { refreshBalance: true });
  if (!session.ok) {
    console.error("[agent] Session failed:", session.error);
    process.exit(1);
  }
  const { store, jwt, engineUrl, blockSlotId } = session;

  const getJwt = () => jwt;
  const client = createClient({
    engineUrl,
    getJwt,
    WebSocket: WebSocket as unknown as typeof globalThis.WebSocket,
    agentWsPath: "/connect",
  });

  client.onMessage("authenticated", (payload: unknown) => {
    const p = payload as { blockId?: string; regionId?: string; sessionId?: string };
    const slot = typeof p.blockId === "string" ? p.blockId : p.regionId;
    if (typeof slot === "string") store.setBlockSlotId(slot);
    if (typeof p.sessionId === "string") store.setMySessionId(p.sessionId);
    console.log("[agent] Connected — engine:", engineUrl, "block slot:", blockSlotId);
  });

  client.onMessage("chat", (payload: unknown) => {
    handleChatMessage(store, config, payload as Parameters<typeof handleChatMessage>[2]);
  });

  client.onMessage("follow_failed", (payload: unknown) => {
    const p = payload as { targetSessionId?: string };
    store.setLastFollowFailed(typeof p?.targetSessionId === "string" ? p.targetSessionId : "");
  });

  const loop = createRunner({
    store,
    config,
    client,
    onUsageReportFailure: (msg) => console.warn("[credits]", msg),
  });
  loop.start();

  const cronTasks = profile?.cronTasks;
  const cronScheduler =
    Array.isArray(cronTasks) && cronTasks.length > 0
      ? startCronScheduler(
          store,
          () =>
            cronTasks.map((t) => ({
              taskId: t.id,
              instruction: t.instruction,
              intervalMs: (t as { intervalMs?: number }).intervalMs ?? 300_000,
            })),
          { checkIntervalMs: 60_000 }
        )
      : null;

  await client.connect();

  const shutdown = (): void => {
    loop.stop();
    cronScheduler?.stop();
    const d = (client as unknown as { disconnect?: () => void }).disconnect;
    if (typeof d === "function") d.call(client);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
