/**
 * Environment variable helpers. Used by config loading.
 */

/** Parse env[key] as int; use defaultVal if missing/invalid. Clamp to [min, max] when provided. */
export function parseIntEnv(
  key: string,
  defaultVal: number,
  min?: number,
  max?: number
): number {
  const raw = process.env[key];
  const n = raw != null ? parseInt(raw, 10) : NaN;
  let val = Number.isFinite(n) ? n : defaultVal;
  if (min != null && val < min) val = min;
  if (max != null && val > max) val = max;
  return val;
}

/** True if env[key] is truthy (1, true, yes). */
export function envFlag(key: string): boolean {
  const v = process.env[key]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
