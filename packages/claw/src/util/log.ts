/** Log to console with [claw] prefix. */
export function clawLog(...args: unknown[]): void {
  console.log("[claw]", ...args);
}

/** Debug log with [claw] prefix. */
export function clawDebug(...args: unknown[]): void {
  console.debug("[claw]", ...args);
}
