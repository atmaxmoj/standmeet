export type QueryQueue = {
  enqueue(sessionId: string, timeoutMs: number): Promise<void>;
  release(sessionId: string): void;
  pending: () => number;
  active: () => number;
};

export function createQueryQueue(maxConcurrent: number): QueryQueue {
  const activeSet = new Set<string>();
  const waitQueue: Array<{
    sessionId: string;
    resolve: () => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  function tryDequeue() {
    while (waitQueue.length > 0 && activeSet.size < maxConcurrent) {
      const next = waitQueue.shift()!;
      clearTimeout(next.timer);
      activeSet.add(next.sessionId);
      next.resolve();
    }
  }

  return {
    async enqueue(sessionId: string, timeoutMs: number): Promise<void> {
      if (activeSet.size < maxConcurrent) {
        activeSet.add(sessionId);
        return;
      }

      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = waitQueue.findIndex((w) => w.sessionId === sessionId);
          if (idx >= 0) waitQueue.splice(idx, 1);
          reject(new Error("Query queue timeout"));
        }, timeoutMs);

        waitQueue.push({ sessionId, resolve, reject, timer });
      });
    },

    release(sessionId: string) {
      activeSet.delete(sessionId);
      tryDequeue();
    },

    pending: () => waitQueue.length,
    active: () => activeSet.size,
  };
}
