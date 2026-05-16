const WINDOW_MS = 60_000; // 60 seconds
const MAX_FAILURES = 10;
const CLEANUP_INTERVAL_MS = 300_000; // 5 minutes

const failuresByIp = new Map<string, number[]>();

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanupTimer() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [ip, timestamps] of failuresByIp) {
      const recent = timestamps.filter((t) => now - t < WINDOW_MS);
      if (recent.length === 0) {
        failuresByIp.delete(ip);
      } else {
        failuresByIp.set(ip, recent);
      }
    }
    if (failuresByIp.size === 0 && cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }, CLEANUP_INTERVAL_MS);
  // Allow process to exit even if timer is running
  if (cleanupTimer && typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref();
  }
}

export function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = failuresByIp.get(ip);
  if (!timestamps) return false;
  const recent = timestamps.filter((t) => now - t < WINDOW_MS);
  failuresByIp.set(ip, recent);
  return recent.length >= MAX_FAILURES;
}

export function recordAuthFailure(ip: string): void {
  const now = Date.now();
  const timestamps = failuresByIp.get(ip) || [];
  timestamps.push(now);
  failuresByIp.set(ip, timestamps);
  ensureCleanupTimer();
}

// For testing
export function resetRateLimiter(): void {
  failuresByIp.clear();
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
