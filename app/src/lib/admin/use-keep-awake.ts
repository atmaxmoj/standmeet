// use-keep-awake —— hold a screen wake lock while the component is mounted so a phone does not sleep
// during a quiet stretch of an interview (used by /cue). The lock drops when the tab is hidden, so
// it is re-acquired on visibility. Absent or refused (old browser, not a secure context) it is a
// no-op — the `?.` guards the browsers that lack the API (same shape as navigator.clipboard here).

import { useEffect } from 'react';

export function useKeepAwake(): void {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      try {
        lock = (await navigator.wakeLock?.request('screen')) ?? null;
      } catch {
        lock = null; // refused (e.g. tab not visible) — the visibility handler retries
      }
    };
    void acquire();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => {});
    };
  }, []);
}
