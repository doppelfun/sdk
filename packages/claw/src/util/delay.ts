/** Resolve after ms milliseconds. Use for minimum wait (e.g. thinking indicator). */
export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
