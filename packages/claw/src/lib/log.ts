export function clawLog(...args: unknown[]): void {
  console.log("[claw]", ...args);
}
export function clawDebug(...args: unknown[]): void {
  console.debug("[claw]", ...args);
}
