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
