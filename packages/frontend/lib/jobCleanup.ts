/**
 * Pure helpers for `/api/jobs/cleanup`.
 */

export const DEFAULT_RETENTION_DAYS = 90;
export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 3650;

export interface RetentionDaysResult {
  ok: boolean;
  days: number;
  error?: string;
}

/**
 * Validate a `retention_days` value coming from a query string or JSON body.
 *
 * The route used to do `body.retention_days || 90`, so `0` silently became 90
 * and negative/NaN/string values were forwarded to the repository - `{"retention_days": -1}`
 * matched *every* job and marked all of them as S3 expired.
 */
export function parseRetentionDays(value: unknown): RetentionDaysResult {
  if (value === undefined || value === null || value === "") {
    return { ok: true, days: DEFAULT_RETENTION_DAYS };
  }

  if (typeof value !== "number" && typeof value !== "string") {
    return {
      ok: false,
      days: DEFAULT_RETENTION_DAYS,
      error: "retention_days must be an integer number of days",
    };
  }

  const parsed = typeof value === "number" ? value : Number(value.trim());

  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return {
      ok: false,
      days: DEFAULT_RETENTION_DAYS,
      error: 'retention_days must be an integer number of days',
    };
  }

  if (parsed < MIN_RETENTION_DAYS || parsed > MAX_RETENTION_DAYS) {
    return {
      ok: false,
      days: DEFAULT_RETENTION_DAYS,
      error: `retention_days must be between ${MIN_RETENTION_DAYS} and ${MAX_RETENTION_DAYS}`,
    };
  }

  return { ok: true, days: parsed };
}
