// use-code-intro —— fetches the intro for the current pending code before
// the name picker issues (a greeting for "what is this" + the name
// cap/usage), for the picker to render. Refetches when the code changes;
// no pending code / fetch failure → null, and the picker falls back gracefully.
// The picker words every line itself, from the catalog: text assembled here or on
// the server is in one language only (F-I-2).

'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { fetchCodeIntro, type CodeIntro } from '@/lib/api/public';
import { usePendingCodeStore } from '@/lib/gate/use-pending-code-store';

type PickerT = ReturnType<typeof useTranslations<'visitor.visitorNamePicker'>>;

// useCodeIntroLines —— the picker's two intro lines, in the UI language. greeting: the role's own
// (as the owner wrote it), else the default; '' when there is no intro (bad code / fetch failed).
// capacity: "Up to N people…"; '' for unlimited / no intro, and the picker says capacityDefault.
export function useCodeIntroLines(): { greeting: string; capacity: string } {
  const intro = useCodeIntro();
  const t = useTranslations('visitor.visitorNamePicker');
  return { greeting: greetingOf(intro, t), capacity: capacityOf(intro, t) };
}

function greetingOf(intro: CodeIntro | null, t: PickerT): string {
  if (intro === null) return '';
  return intro.greeting !== '' ? intro.greeting : defaultGreeting(intro.handle, t);
}

function defaultGreeting(handle: string, t: PickerT): string {
  return handle !== '' ? t('defaultGreeting', { handle }) : t('defaultGreetingAnon');
}

function capacityOf(intro: CodeIntro | null, t: PickerT): string {
  if (intro === null || intro.max_members <= 0) return '';
  return t('capacity', { max: intro.max_members, count: intro.member_count });
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
