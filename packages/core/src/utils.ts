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

/** True if body looks like an HTML document (SPA shell, 404 page, etc.). */
function responseLooksLikeHtml(text: string): boolean {
  const t = text.trimStart().toLowerCase();
  return t.startsWith("<!doctype") || t.startsWith("<html");
}

/** Truncate for error messages so logs stay readable. */
function truncateBody(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Fetch and parse JSON. Throws on non-OK status or non-JSON body.
 *
 * Engines with SPA fallback may return index.html (200) for unknown GET /api/* routes.
 * Parsing that as JSON yields opaque errors; we detect HTML and suggest redeploy/base URL.
 */
export async function fetchJson<T>(url: string, init: RequestInit, errorLabel: string): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();

  if (!res.ok) {
    if (responseLooksLikeHtml(text)) {
      throw new Error(
        `${errorLabel} ${res.status}: server returned HTML (API route likely missing—redeploy engine or fix base URL).`
      );
    }
    throw new Error(`${errorLabel} ${res.status}: ${truncateBody(text, 500)}`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    if (responseLooksLikeHtml(text)) {
      throw new Error(
        `${errorLabel}: server returned HTML instead of JSON (route missing on engine—redeploy doppel-engine or fix ENGINE_URL).`
      );
    }
    throw new Error(`${errorLabel}: response is not JSON (${truncateBody(text, 300)})`);
  }
}
