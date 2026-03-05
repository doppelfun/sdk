/**
 * OpenRouter credit purchase via the Doppel hub's spender API.
 * The hub's spender EOA pulls ETH from the user's Base Account via spend permission,
 * then purchases OpenRouter credits on behalf of the agent.
 */

/**
 * Purchase OpenRouter credits by requesting the hub to execute a spend.
 *
 * Flow:
 * 1. Call hub POST /api/agents/me/purchase-credits with desired USD amount
 * 2. Hub's spender pulls ETH from the user's Base Account via spend permission
 * 3. Hub purchases OpenRouter credits with the pulled ETH
 */
export async function purchaseCredits(opts: {
  hubUrl: string;
  apiKey: string;
  amountUsd: number;
}): Promise<{ ok: true; creditsAdded: number } | { ok: false; error: string }> {
  const { hubUrl, apiKey, amountUsd } = opts;

  try {
    const res = await fetch(`${hubUrl}/api/agents/me/purchase-credits`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ amountUsd }),
    });

    const data = (await res.json()) as { ok?: boolean; creditsAdded?: number; error?: string };

    if (!res.ok) {
      return { ok: false, error: data.error || `Hub API ${res.status}` };
    }

    return { ok: true, creditsAdded: data.creditsAdded ?? amountUsd };
  } catch (e) {
    return {
      ok: false,
      error: `Hub request failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * Report LLM usage to the hub for per-request metering and charging.
 * Fire-and-forget from the caller's perspective — network errors are swallowed
 * but hub warnings (e.g. insufficient credits) are logged.
 */
export async function reportUsage(opts: {
  hubUrl: string;
  apiKey: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}): Promise<void> {
  try {
    const res = await fetch(`${opts.hubUrl}/api/agents/me/report-usage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        promptTokens: opts.promptTokens,
        completionTokens: opts.completionTokens,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[reportUsage] hub returned ${res.status}: ${body}`);
    } else {
      const data = (await res.json().catch(() => null)) as { warning?: string } | null;
      if (data?.warning) console.warn(`[reportUsage] ${data.warning}`);
    }
  } catch {
    /* swallow network errors — metering shouldn't break the agent */
  }
}
