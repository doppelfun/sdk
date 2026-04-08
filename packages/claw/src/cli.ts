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
import { pickAutonomousOpeningGreeting } from "./lib/chat/openingGreetings.js";
import { joinBlock } from "./lib/hub/index.js";
import { normalizeUrl } from "./util/url.js";

// Load .env from cwd, package dir, and parent dir (monorepo root when running from packages/claw)
const cwd = process.cwd();
loadDotenv({ path: resolve(cwd, ".env") });
loadDotenv({ path: resolve(cwd, "..", "..", ".env") });

async function main(): Promise<void> {
  const { config, profile } = await bootstrapAgent();
  const blockId = getDefaultBlockId(profile, config, "0_0");

  const session = await createSession(config, blockId);
  if (!session.ok) {
    console.error("[agent] Session failed:", session.error);
    process.exit(1);
  }
  const { store, jwt, engineUrl, blockSlotId } = session;

  const jwtRef = { current: jwt };
  const client = createClient({
    engineUrl,
    getJwt: () => jwtRef.current,
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
    const tid = typeof p?.targetSessionId === "string" ? p.targetSessionId : "";
    store.setLastFollowFailed(tid);
    const state = store.getState();
    if (state.autonomousGoal === "approach" && state.autonomousTargetSessionId === tid) {
      store.setAutonomousGoal("wander");
      store.setAutonomousTargetSessionId(null);
    }
  });

  client.onMessage("approach_arrived", (payload: unknown) => {
    const p = payload as { targetSessionId?: string };
    const targetSessionId = typeof p?.targetSessionId === "string" ? p.targetSessionId : null;
    if (targetSessionId) {
      store.setAutonomousGoal("converse");
      store.setPendingGoTalkToAgent({
        targetSessionId,
        openingMessage: pickAutonomousOpeningGreeting(),
      });
    }
    store.setFollowTargetSessionId(null);
  });

  client.onMessage("move_to_failed", (payload: unknown) => {
    const p = payload as { x?: number; z?: number };
    store.setMovementTarget(null);
    store.setLastMoveToFailed(
      typeof p?.x === "number" && typeof p?.z === "number" ? { x: p.x, z: p.z } : null
    );
    store.setNextWanderDestinationAt(Date.now() + 2000);
  });

  const loop = createRunner({
    store,
    config,
    client,
    onUsageReportFailure: (msg) => console.warn("[credits]", msg),
    refreshHubSession: async () => {
      const bid = config.blockId;
      if (!bid) {
        console.warn("[claw] Cannot refresh hub JWT: no blockId on config");
        return;
      }
      const r = await joinBlock(config.agentApiUrl, config.apiKey, bid);
      if (!r.ok) {
        console.warn("[claw] Hub re-join failed:", r.error);
        return;
      }
      jwtRef.current = r.jwt;
      config.blockId = r.blockId;
      if (r.serverUrl.trim() !== "") {
        config.engineUrl = normalizeUrl(r.serverUrl.trim());
      }
      await client.reconnectNow();
    },
  });

  // Connect WebSocket first so the agent has a single connection. If we start the loop
  // before connecting, refreshOccupants() runs and calls getSessionToken() (POST /api/session),
  // which creates a session and marks the agent connected; then the WS connect would see
  // "already connected" and the server would have two connection paths for one agent.
  await client.connect();
  loop.start();

  // HACK: will be added with cron DB list on the future
  // Wake-driven cron: spellcast task (hard-coded) + any profile cron tasks. LLM executes instructions.
  // const SPELLCAST_CRON_TASK = {
  //   taskId: "spellcast",
  //   instruction: "Go to position 34,30 and perform the spellcast emote.",
  //   intervalMs: 2 * 60 * 1000, // Every 2 minutes
  // };
  // // ------------------------------------------------------------

  // const cronScheduler = startCronScheduler(
  //   store,
  //   () => [
  //     SPELLCAST_CRON_TASK,
  //     ...(Array.isArray(profile?.cronTasks)
  //       ? profile.cronTasks.map((t) => ({
  //           taskId: t.id,
  //           instruction: t.instruction,
  //           intervalMs: (t as { intervalMs?: number }).intervalMs ?? 300_000,
  //         }))
  //       : []),
  //   ],
  //   { checkIntervalMs: 60_000 }
  // );

  const shutdown = (): void => {
    loop.stop();
    // cronScheduler.stop();
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
