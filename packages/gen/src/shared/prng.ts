/** Mulberry32 PRNG — deterministic from seed. */
export function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Round to 2 decimals for MML attributes. */
export const r2 = (n: number) => n.toFixed(2);

/** Radians → degrees, rounded to 1 decimal. */
export const deg = (r: number) => ((r * 180) / Math.PI).toFixed(1);
