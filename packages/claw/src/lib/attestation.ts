/**
 * Claw usage attestation: build canonical payload and sign with Ed25519.
 * Must match hub canonical format (see doppel-app src/lib/attestation.ts).
 */

import { createPrivateKey, randomFillSync, sign } from "node:crypto";

/** Build canonical payload for LLM usage attestation (same format as hub). */
export function buildUsagePayload(params: {
  agentId: string;
  blockId: string | null;
  promptTokens: number;
  completionTokens: number;
  model: string;
  timestamp: string;
  nonce: string;
}): string {
  const blockId = params.blockId ?? "";
  const model = params.model ?? "";
  return [
    `agentId=${params.agentId}`,
    `blockId=${blockId}`,
    `completionTokens=${params.completionTokens}`,
    `model=${model}`,
    `nonce=${params.nonce}`,
    `promptTokens=${params.promptTokens}`,
    `timestamp=${params.timestamp}`,
  ].join("&");
}

/** Build canonical payload for voice usage attestation (same format as hub). */
export function buildVoicePayload(params: {
  agentId: string;
  blockId: string | null;
  characters: number;
  timestamp: string;
  nonce: string;
}): string {
  const blockId = params.blockId ?? "";
  return [
    `agentId=${params.agentId}`,
    `blockId=${blockId}`,
    `characters=${params.characters}`,
    `nonce=${params.nonce}`,
    `timestamp=${params.timestamp}`,
    "type=voice",
  ].join("&");
}

/**
 * Sign payload with Ed25519. privateKeyBase64 is PKCS8 DER base64 (from CLAW_ATTESTATION_PRIVATE_KEY).
 * Returns signature as base64.
 */
export function signPayload(payload: string, privateKeyBase64: string): string {
  const keyBuf = Buffer.from(privateKeyBase64, "base64");
  const key = createPrivateKey({ key: keyBuf, format: "der", type: "pkcs8" });
  const sig = sign(null, Buffer.from(payload, "utf8"), key);
  return sig.toString("base64");
}

export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  randomFillSync(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
