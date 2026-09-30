/**
 * Shared helpers for talking to the Flask AI pipeline.
 *
 * The browser must never call the pipeline directly: the default base URL used
 * to be a hardcoded LAN address (http://192.168.1.105:5000) in some routes and
 * http://localhost:5000 in others, so the admin UI silently broke everywhere
 * except on that machine. Every route now resolves the base URL from
 * AI_PIPELINE_URL and falls back to the documented loopback default.
 */

export const DEFAULT_AI_PIPELINE_URL = "http://127.0.0.1:5000";

export const DEFAULT_AI_PIPELINE_TIMEOUT_MS = 10_000;

export function getAiPipelineBaseUrl(): string {
  const configured = process.env.AI_PIPELINE_URL;
  const base = configured && configured.trim().length > 0 ? configured.trim() : DEFAULT_AI_PIPELINE_URL;
  return base.replace(/\/+$/, "");
}

export function buildAiPipelineUrl(path: string, baseUrl: string = getAiPipelineBaseUrl()): string {
  const base = baseUrl.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

/**
 * Fetch from the pipeline with a hard timeout.
 * Returns `null` when the pipeline is unreachable/timing out so callers can fall
 * back to cached data instead of failing the whole request.
 */
export async function fetchFromAiPipeline(
  path: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_AI_PIPELINE_TIMEOUT_MS
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(buildAiPipelineUrl(path), {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (error) {
    console.error(`[AI Pipeline] Request to ${path} failed:`, error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
