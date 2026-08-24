/**
 * Best-effort, in-memory rate limit for the reading write endpoint (§10).
 * Serverless instances are ephemeral and this project has no Redis/KV
 * budget, so this only bounds abuse within a single warm instance — it is
 * a speed bump against a runaway client or script, not a hard guarantee.
 */
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 30;

const hits = new Map<string, number[]>();

export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const timestamps = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  timestamps.push(now);
  hits.set(key, timestamps);
  return timestamps.length > MAX_REQUESTS_PER_WINDOW;
}
