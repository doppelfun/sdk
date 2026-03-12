/**
 * Claw agent logging. Set CLAW_VERBOSE=1 for chat previews and fuller context.
 */

export function clawVerbose(): boolean {
  const v = process.env.CLAW_VERBOSE;
  return v === "1" || v === "true" || v === "yes";
}

/** Always-on agent lifecycle / tick / LLM / tool lines */
export function clawLog(...args: unknown[]): void {
  console.log("[claw]", ...args);
}

/** Only when CLAW_VERBOSE=1 — avoids flooding with large payloads */
export function clawDebug(...args: unknown[]): void {
  if (clawVerbose()) console.log("[claw:debug]", ...args);
}
