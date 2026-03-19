/**
 * Claw usage attestation: build canonical payload and sign with Ed25519 (ox).
 * Must match hub canonical format (see doppel-app src/lib/attestation.ts).
 * Private key from env is hex; signature is returned as base64 for the API.
 */

import { randomFillSync } from "node:crypto";
import { Base64, Bytes, Ed25519 } from "ox";

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
 * Sign payload with Ed25519. privateKeyHex is from CLAW_ATTESTATION_PRIVATE_KEY (hex).
 * Returns signature as base64 for the report-usage request body.
 */
export function signPayload(payload: string, privateKeyHex: string): string {
  const signatureBytes = Ed25519.sign({
    payload: Bytes.fromString(payload),
    privateKey: privateKeyHex as `0x${string}`,
    as: "Bytes",
  });
  return Base64.fromBytes(signatureBytes);
}

export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  randomFillSync(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
