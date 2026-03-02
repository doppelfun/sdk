/**
 * OpenRouter crypto credit purchase via their Coinbase/Base API.
 * Uses Privy server-wallet to sign and send native ETH on Base → Uniswap swap → credits.
 */

import type { PrivyClient } from "@privy-io/node";

const OPENROUTER_API = "https://openrouter.ai/api/v1";
const BASE_CHAIN_ID = 8453;

type CryptoResponse = {
  data?: {
    web3_data?: {
      call_data?: string;
      to?: string;
      value?: string;
    };
    credits_added?: number;
  };
  error?: string;
};

/**
 * Purchase OpenRouter credits using native ETH on Base via their crypto API.
 *
 * Flow:
 * 1. Call OpenRouter POST /api/v1/credits/coinbase with desired USD amount
 * 2. Get back transaction calldata (Uniswap swap)
 * 3. Sign and send via Privy server-wallet
 */
export async function purchaseCredits(opts: {
  privyClient: PrivyClient;
  walletId: string;
  sessionPrivateKey: string;
  amountUsd: number;
  openRouterApiKey: string;
}): Promise<{ ok: true; creditsAdded: number } | { ok: false; error: string }> {
  const { privyClient, walletId, sessionPrivateKey, amountUsd, openRouterApiKey } = opts;

  // 1. Get swap calldata from OpenRouter
  let cryptoRes: CryptoResponse;
  try {
    const res = await fetch(`${OPENROUTER_API}/credits/coinbase`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openRouterApiKey}`,
      },
      body: JSON.stringify({
        amount: amountUsd,
        chain_id: BASE_CHAIN_ID,
        sender: walletId,
      }),
    });
    cryptoRes = (await res.json()) as CryptoResponse;
    if (!res.ok) {
      return { ok: false, error: cryptoRes.error || `OpenRouter API ${res.status}` };
    }
  } catch (e) {
    return { ok: false, error: `OpenRouter request failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  const web3 = cryptoRes.data?.web3_data;
  if (!web3?.call_data || !web3.to) {
    return { ok: false, error: "No web3_data in OpenRouter response" };
  }

  // 2. Sign and send via Privy wallet (CAIP-2 format for Base mainnet)
  try {
    await privyClient.wallets().ethereum().sendTransaction(walletId, {
      caip2: `eip155:${BASE_CHAIN_ID}`,
      params: {
        transaction: {
          to: web3.to,
          value: web3.value || "0",
          data: web3.call_data,
        },
      },
      authorization_context: {
        authorization_private_keys: [sessionPrivateKey],
      },
    });
  } catch (e) {
    return { ok: false, error: `Transaction failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  return { ok: true, creditsAdded: cryptoRes.data?.credits_added ?? amountUsd };
}
