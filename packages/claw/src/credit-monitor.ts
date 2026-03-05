/**
 * Background credit monitor: periodically checks hub credit balance
 * and auto-purchases credits when balance drops below threshold.
 */

import type { ClawConfig } from "./config.js";
import { purchaseCredits } from "./openrouter-credits.js";

const CHECK_INTERVAL_MS = 60_000;
let purchasing = false;

async function checkAndTopUp(config: ClawConfig, onLog?: (msg: string) => void) {
  try {
    const res = await fetch(`${config.hubUrl}/api/agents/me/credits`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    if (!res.ok) {
      onLog?.(`[credit-monitor] balance check failed: ${res.status}`);
      return;
    }
    const { balance } = (await res.json()) as { balance: number };
    onLog?.(`[credit-monitor] credit balance: $${balance.toFixed(2)}`);

    if (balance < config.creditTopUpThresholdUsd && !purchasing) {
      purchasing = true;
      onLog?.(
        `[credit-monitor] balance below $${config.creditTopUpThresholdUsd}, purchasing $${config.creditTopUpAmountUsd}...`
      );
      const result = await purchaseCredits({
        hubUrl: config.hubUrl,
        apiKey: config.apiKey,
        amountUsd: config.creditTopUpAmountUsd,
      });
      if (result.ok) {
        onLog?.(`[credit-monitor] purchased $${result.creditsAdded} credits`);
      } else {
        onLog?.(`[credit-monitor] purchase failed: ${result.error}`);
      }
      purchasing = false;
    }
  } catch (e) {
    purchasing = false;
    onLog?.(`[credit-monitor] error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Start a background loop that monitors hub credit balance and auto-purchases
 * credits when balance drops below the configured threshold.
 */
export function startCreditMonitor(config: ClawConfig, onLog?: (msg: string) => void): void {
  const check = () => checkAndTopUp(config, onLog);

  // Initial check after short delay, then periodic
  setTimeout(check, 5_000);
  setInterval(check, CHECK_INTERVAL_MS);
}
