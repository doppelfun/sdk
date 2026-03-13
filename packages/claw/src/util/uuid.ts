/** UUID v4 regex (8-4-4-4-12 hex). Use for documentId and other UUID validation. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(id: string): boolean {
  return typeof id === "string" && UUID_RE.test(id.trim());
}
