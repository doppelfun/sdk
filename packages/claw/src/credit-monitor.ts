/**
 * Background credit monitor: periodically checks OpenRouter credit balance
 * and auto-tops-up via the hub's spender when balance drops below threshold.
 */

import type { ClawConfig } from "./config.js";
import { purchaseCredits } from "./openrouter-credits.js";

const CHECK_INTERVAL_MS = 60_000;
const OPENROUTER_CREDITS_URL = "https://openrouter.ai/api/v1/credits";

type CreditsResponse = {
  data?: {
    total_credits?: number;
    usage?: number;
    balance?: number;
  };
};

async function checkBalance(apiKey: string): Promise<number | null> {
  try {
    const res = await fetch(OPENROUTER_CREDITS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as CreditsResponse;
    return body.data?.balance ?? body.data?.total_credits ?? null;
  } catch {
    return null;
  }
}

/**
 * Start a background loop that monitors OpenRouter credit balance
 * and purchases more via the hub's spender when it drops below threshold.
 */
export function startCreditMonitor(
  config: ClawConfig,
  onLog?: (msg: string) => void
): void {
  const {
    hubUrl,
    apiKey,
    openRouterApiKey,
    creditTopUpThresholdUsd,
    creditTopUpAmountUsd,
  } = config;

  if (!hubUrl || !apiKey) {
    return;
  }

  let purchasing = false;

  const check = async () => {
    if (purchasing) return;

    const balance = await checkBalance(openRouterApiKey);
    if (balance === null) {
      onLog?.("[credit-monitor] Failed to check OpenRouter balance");
      return;
    }

    onLog?.(`[credit-monitor] OpenRouter balance: $${balance.toFixed(2)}`);

    if (balance < creditTopUpThresholdUsd) {
      purchasing = true;
      onLog?.(
        `[credit-monitor] Balance below $${creditTopUpThresholdUsd}, purchasing $${creditTopUpAmountUsd} in credits...`
      );

      const result = await purchaseCredits({
        hubUrl,
        apiKey,
        amountUsd: creditTopUpAmountUsd,
      });

      if (result.ok) {
        onLog?.(
          `[credit-monitor] Purchased $${creditTopUpAmountUsd} in credits (${result.creditsAdded} credits added)`
        );
      } else {
        onLog?.(`[credit-monitor] Purchase failed: ${result.error}`);
      }

      purchasing = false;
    }
  };

  // Initial check after short delay, then periodic
  setTimeout(check, 5_000);
  setInterval(check, CHECK_INTERVAL_MS);
}
