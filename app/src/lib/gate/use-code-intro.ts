// use-code-intro —— fetches the intro for the current pending code before
// the name picker issues (a greeting for "what is this" + the name
// cap/usage), for the picker to render. Refetches when the code changes;
// no pending code / fetch failure → null, and the picker falls back gracefully.

'use client';

import { useEffect, useState } from 'react';

import { fetchCodeIntro, type CodeIntro } from '@/lib/api/public';
import { usePendingCodeStore } from '@/lib/gate/use-pending-code-store';

// memberCapacityLine —— "Up to N people can use this code — M already in".
// max_members=0 (unlimited) / no intro → empty string, and the picker
// falls back to the default "More than one person".
export function memberCapacityLine(intro: CodeIntro | null): string {
  if (intro === null || intro.max_members <= 0) return '';
  const noun = intro.max_members === 1 ? 'person' : 'people';
  return `Up to ${intro.max_members} ${noun} can use this code — ${intro.member_count} already in.`;
}

export function useCodeIntro(): CodeIntro | null {
  const code = usePendingCodeStore((s) => s.code);
  const [intro, setIntro] = useState<CodeIntro | null>(null);
  useEffect(() => {
    if (code === null) {
      setIntro(null);
      return;
    }
    let alive = true;
    void fetchCodeIntro(code).then((r) => {
      if (alive) setIntro(r);
    });
    return () => {
      alive = false;
    };
  }, [code]);
  return intro;
}
