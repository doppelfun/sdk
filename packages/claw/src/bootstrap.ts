/**
 * Bootstrap and session helpers: fetch profile, join block, create store, refresh balance.
 * Use before starting the runner so config and store are ready.
 */
import { loadConfig, type ClawConfig } from "./lib/config/index.js";
import { getAgentProfile, joinBlock, type HubAgentProfile } from "./lib/hub/index.js";
import { applyHubProfileToConfig } from "./lib/hub/profile.js";
import { createClawStore, type ClawStore } from "./lib/state/index.js";
import { refreshBalance } from "./lib/credits/index.js";

export type BootstrapResult = {
  config: ClawConfig;
  /** Applied profile (if fetch succeeded). */
  profileApplied: boolean;
  /** Raw profile when fetch succeeded (e.g. for defaultBlock, cronTasks). */
  profile?: HubAgentProfile;
};

/**
 * Load config and fetch agent profile from hub; merge profile into config.
 * Call once at startup. Returns config with voiceEnabled, dailyCreditBudget, soul, etc. from hub.
 */
export async function bootstrapAgent(): Promise<BootstrapResult> {
  const config = loadConfig();
  const res = await getAgentProfile(config.agentApiUrl, config.apiKey);
  let profileApplied = false;
  let profile: HubAgentProfile | undefined;
  if (res.ok) {
    applyHubProfileToConfig(config, res.profile);
    profileApplied = true;
    profile = res.profile;
  }
  const reportUsage = config.hosted && !config.skipCreditReport;
  const checkBalance = config.hosted;
  console.log(
    "[claw] Credits: hosted=%s skipCreditReport=%s → report-usage %s, balance checks %s",
    config.hosted,
    config.skipCreditReport,
    reportUsage ? "on" : "off",
    checkBalance ? "on" : "off"
  );
  return { config, profileApplied, profile };
}

/** Resolve block id for join: profile defaultBlock / default_space_id, then config.blockId, then fallback. */
export function getDefaultBlockId(profile: HubAgentProfile | undefined, config: ClawConfig, fallback: string): string {
  const fromProfile =
    (profile?.defaultBlock as { blockId?: string } | undefined)?.blockId ??
    (typeof profile?.default_space_id === "string" ? profile.default_space_id.trim() : null);
  if (fromProfile) return fromProfile;
  if (config.blockId) return config.blockId;
  return fallback;
}

export type SessionResult =
  | { ok: true; store: ClawStore; jwt: string; engineUrl: string; blockSlotId: string }
  | { ok: false; error: string };

/**
 * Join a block and create the agent store. Optionally refresh balance for hosted agents.
 * Call after bootstrapAgent(); use jwt and engineUrl to create and connect the engine client.
 */
export async function createSession(
  config: ClawConfig,
  blockId: string,
  options?: { refreshBalance?: boolean }
): Promise<SessionResult> {
  const join = await joinBlock(config.agentApiUrl, config.apiKey, blockId);
  if (!join.ok) return { ok: false, error: join.error };
  const store = createClawStore(join.blockSlotId);
  if (options?.refreshBalance && config.hosted) {
    const balanceRes = await refreshBalance(store, config);
    if (balanceRes.ok) {
      console.log("[claw] Credits: fetched balance", balanceRes.balance.toFixed(2));
    } else {
      console.warn("[claw] Credits: balance fetch failed —", balanceRes.error);
    }
  }
  return {
    ok: true,
    store,
    jwt: join.jwt,
    engineUrl: join.serverUrl,
    blockSlotId: join.blockSlotId,
  };
}
