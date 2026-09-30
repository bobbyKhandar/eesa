/**
 * Presentation-safe helpers for Bloom's Taxonomy distributions.
 *
 * Reports produced before the guarded backend helpers existed (or produced by
 * a partially-failed analysis) can be missing levels or carry `null` /
 * non-numeric values. Rendering code used to call `.toFixed()` straight on
 * those values, which threw and blanked the whole report page.
 */

export const BLOOM_LEVELS = [
  "Recall",
  "Understand",
  "Apply",
  "Analyze",
  "Evaluate",
  "Create",
] as const;

export type BloomLevel = (typeof BLOOM_LEVELS)[number];

export type BloomDistributionInput = unknown;

export interface BloomRow {
  level: BloomLevel;
  percentage: number;
}

/**
 * Accepts an unknown input on purpose: callers hold strongly-typed (or legacy,
 * partially populated) report objects that cannot be narrowed here.
 */
export function sanitizeBloomDistribution(
  distribution: unknown
): Record<BloomLevel, number> {
  const source: Record<string, unknown> =
    distribution && typeof distribution === "object"
      ? (distribution as Record<string, unknown>)
      : {};

  const safe = {} as Record<BloomLevel, number>;

  for (const level of BLOOM_LEVELS) {
    const value = source[level];
    safe[level] =
      typeof value === "number" && Number.isFinite(value) && value > 0
        ? value
        : 0;
  }

  return safe;
}

/** Ordered, chart-ready rows for every Bloom level (missing levels become 0). */
export function toBloomRows(distribution: BloomDistributionInput): BloomRow[] {
  const safe = sanitizeBloomDistribution(distribution);
  return BLOOM_LEVELS.map((level) => ({ level, percentage: safe[level] }));
}