// consume-question-url —— on landing on `/?q=...&from=...`, feed q into chat
// once + replaceState to clean the URL. Called once when PageShell mounts.
//
// "URL only carries the entry point, state goes into the store" —— same
// pattern as use-absorb-code.

import { useEffect } from 'react';

export function useConsumeQuestionFromURL(ask: (q: string) => void): void {
  useEffect(() => {
    consumeOnce(ask);
    // Run only once: a change in the ask function's closure shouldn't
    // make the starter fire again.
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
