/**
 * Background credit monitor: periodically checks OpenRouter credit balance
 * and logs it. Read-only — per-request charging is handled by the hub's
 * report-usage endpoint instead of bulk auto-purchases.
 */

import type { ClawConfig } from "./config.js";

const CHECK_INTERVAL_MS = 60_000;
const OPENROUTER_CREDITS_URL = "https://openrouter.ai/api/v1/credits";

type CreditsResponse = {
  data?: {
    total_credits?: number;
    total_usage?: number;
  };
};

async function checkBalance(apiKey: string): Promise<number | null> {
  try {
    const res = await fetch(OPENROUTER_CREDITS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as CreditsResponse;
    const total = body.data?.total_credits;
    if (total == null) return null;
    return total - (body.data?.total_usage ?? 0);
  } catch {
    return null;
  }
}

/**
 * Start a background loop that monitors the shared OpenRouter credit balance.
 * Logs the balance periodically so operators know when the pool runs low.
 */
export function startCreditMonitor(
  config: ClawConfig,
  onLog?: (msg: string) => void
): void {
  const { openRouterApiKey } = config;

  const check = async () => {
    const balance = await checkBalance(openRouterApiKey);
    if (balance === null) {
      onLog?.("[credit-monitor] Failed to check OpenRouter balance");
      return;
    }

    onLog?.(`[credit-monitor] OpenRouter balance: $${balance.toFixed(2)}`);
  };

  // Initial check after short delay, then periodic
  setTimeout(check, 5_000);
  setInterval(check, CHECK_INTERVAL_MS);
}
