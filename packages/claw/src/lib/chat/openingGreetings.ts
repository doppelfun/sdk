/**
 * Stock opening lines for autonomous approach (movement driver) and CLI arrival.
 * Keep `matchesStockOpeningGreeting` in sync when adding phrases so shouldSkipOpeningGreeting still works.
 */

const NORMALIZE = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[!?.…]+$/g, "")
    .trim();

/** Lines picked at random when the agent reaches someone to start a DM. */
export const AUTONOMOUS_OPENING_GREETINGS = [
  "Hi!",
  "Hey there!",
  "Hello!",
  "Oh hey!",
  "What's up?",
  "Hi there!",
  "Hello there!",
  "Hey — good to see you!",
  "How's it going?",
  "Nice to run into you!",
] as const;

const NORMALIZED_STOCK = new Set(
  (AUTONOMOUS_OPENING_GREETINGS as readonly string[]).map((g) => NORMALIZE(g))
);

export function pickAutonomousOpeningGreeting(): string {
  const list = AUTONOMOUS_OPENING_GREETINGS;
  return list[Math.floor(Math.random() * list.length)]!;
}

/** True if text matches one of the stock autonomous openings (after normalization). */
export function matchesStockOpeningGreeting(text: string): boolean {
  return NORMALIZED_STOCK.has(NORMALIZE(text));
}
