/**
 * Merge hub agent profile into config (and optionally store).
 * Call after fetchAgentProfile on bootstrap so the loop and agents use profile-driven settings.
 */

import type { ClawConfig } from "../config/index.js";
import type { HubAgentProfile } from "./hub.js";
import type { ClawStore } from "../state/index.js";

/**
 * Apply hub profile to config (mutates config).
 * Sets voiceEnabled, dailyCreditBudget, soul; when hub has hosted, can set config.hosted.
 */
export function applyHubProfileToConfig(config: ClawConfig, profile: HubAgentProfile): void {
  if (typeof profile.voiceEnabled === "boolean") config.voiceEnabled = profile.voiceEnabled;
  if (typeof profile.dailyCreditBudget === "number" && profile.dailyCreditBudget >= 0) {
    config.dailyCreditBudget = profile.dailyCreditBudget;
  }
  if (profile.soul !== undefined) config.soul = profile.soul ?? null;
  if (typeof profile.hosted === "boolean") config.hosted = profile.hosted;
  if (typeof profile.id === "string") config.agentId = profile.id;
}

/**
 * Update store with cached balance (e.g. after checkBalance or reportUsage).
 */
export function setCachedBalance(store: ClawStore, balance: number): void {
  store.setCachedBalance(balance);
}
