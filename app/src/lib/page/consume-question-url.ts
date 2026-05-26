// consume-question-url —— `/?q=...&from=...` 落地时把 q 一次性喂进 chat
// + replaceState 清 URL。被 PageShell mount 时调一次。
//
// "URL 只承载 entry，状态进 store" —— 跟 use-absorb-code 同模式。

import { useEffect } from 'react';

export function useConsumeQuestionFromURL(ask: (q: string) => void): void {
  useEffect(() => {
    consumeOnce(ask);
    // 只跑一次：ask 函数闭包变化不该让 starter 再 fire 一遍。
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot URL consumer
  }, []);
}

function consumeOnce(ask: (q: string) => void): void {
  const q = readQuestionFromURL();
  if (q === null) return;
  stripQuestionFromURL();
  ask(q);
}

function readQuestionFromURL(): string | null {
  if (typeof window === 'undefined') return null;
  const q = new URL(window.location.href).searchParams.get('q');
  return q !== null && q !== '' ? q : null;
}

function stripQuestionFromURL(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.delete('q');
  url.searchParams.delete('from');
  const rest = url.searchParams.toString();
  const next = url.pathname + (rest ? `?${rest}` : '') + url.hash;
  window.history.replaceState(null, '', next);
}
