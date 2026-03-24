/**
 * Log AI SDK / provider HTTP errors (e.g. AI_APICallError) with response body for debugging.
 */
import { clawLog } from "./log.js";

const MAX_BODY_LOG = 8000;

function logOneApiError(label: string, e: unknown): void {
  if (!e || typeof e !== "object") return;
  const o = e as Record<string, unknown>;
  if (typeof o.statusCode === "number") {
    clawLog("LLM error statusCode", label, String(o.statusCode));
  }
  if (typeof o.url === "string" && o.url.length > 0) {
    clawLog("LLM error url", label, o.url);
  }
  const rawBody =
    typeof o.responseBody === "string"
      ? o.responseBody
      : typeof o.response === "string"
        ? o.response
        : typeof o.body === "string"
          ? o.body
          : undefined;
  if (typeof rawBody === "string" && rawBody.length > 0) {
    clawLog(
      "LLM error responseBody",
      label,
      rawBody.length > MAX_BODY_LOG ? rawBody.slice(0, MAX_BODY_LOG) + "…" : rawBody
    );
  }
  if (o.data !== undefined) {
    try {
      const s = typeof o.data === "string" ? o.data : JSON.stringify(o.data);
      clawLog("LLM error data", label, s.length > MAX_BODY_LOG ? s.slice(0, MAX_BODY_LOG) + "…" : s);
    } catch {
      clawLog("LLM error data", label, String(o.data));
    }
  }
}

/**
 * Logs message, optional AI_APICallError fields (statusCode, url, responseBody, data), one-level cause, then stack.
 */
export function logClawAiSdkApiError(label: string, context: string, e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e);
  clawLog("LLM error", label, context, msg);
  logOneApiError(label, e);
  if (e && typeof e === "object" && "cause" in e) {
    const c = (e as { cause?: unknown }).cause;
    if (c != null && c !== e) {
      clawLog("LLM error cause", label, context);
      logOneApiError(label, c);
      const cmsg = c instanceof Error ? c.message : String(c);
      if (cmsg && cmsg !== msg) {
        clawLog("LLM error cause message", label, cmsg);
      }
    }
  }
  const stack = e instanceof Error ? e.stack : undefined;
  if (stack) clawLog("LLM error stack:", stack);
}
