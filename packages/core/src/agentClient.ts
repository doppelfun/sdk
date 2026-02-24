/**
 * Agent HTTP client: session token.
 */

import { fetchJson, normalizeBaseUrl } from "./utils.js";

export type AgentClientOptions = {
  serverUrl: string;
  /** Optional x-api-key header for POST /session. */
  apiKey?: string;
};

/**
 * Create an agent client for session.
 * - getSession(userId): POST /session with body { userId } → sessionToken (guest-style; for JWT use POST /session with Bearer JWT).
 */
export function createAgentClient(options: AgentClientOptions): {
  getSession(userId: string): Promise<string>;
} {
  const base = normalizeBaseUrl(options.serverUrl);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.apiKey) headers["x-api-key"] = options.apiKey;

  return {
    async getSession(userId: string): Promise<string> {
      const data = await fetchJson<{ sessionToken: string }>(
        `${base}/session`,
        { method: "POST", headers, body: JSON.stringify({ userId }) },
        "session"
      );
      return data.sessionToken;
    },
  };
}
