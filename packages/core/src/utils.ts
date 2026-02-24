/**
 * Internal URL and fetch helpers shared by agent client, agent WS, and chat.
 */

/** Strip trailing slash from a base URL. */
export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, "");
}

/** Same as normalizeBaseUrl but use ws(s) scheme. */
export function toWsBase(url: string): string {
  return normalizeBaseUrl(url).replace(/^http/, "ws");
}

/**
 * Fetch JSON; throw with status and body text if !res.ok.
 */
export async function fetchJson<T>(url: string, init: RequestInit, errorLabel: string): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`${errorLabel} ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}
