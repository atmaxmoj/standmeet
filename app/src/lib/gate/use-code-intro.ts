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
import { usePendingCodeStore } from '@standmeet/sdk';

type PickerT = ReturnType<typeof useTranslations<'visitor.visitorNamePicker'>>;

// useCodeIntroLines —— the picker's two intro lines, in the UI language. greeting: the role's own
// (as the owner wrote it), else the default; '' when there is no intro (bad code / fetch failed).
// capacity: "Up to N people…"; '' for unlimited / no intro, and the picker says capacityDefault.
export function useCodeIntroLines(intro: CodeIntro | null): { greeting: string; capacity: string } {
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

// CodeCheck —— what the backend said about the pending code: 'checking' until it answers, 'closed'
// when it refuses the code (revoked / expired / unknown), else the intro (null: unreadable, the
// picker still works).
export type CodeCheck = CodeIntro | null | 'closed' | 'checking';

export function useCodeIntro(): CodeCheck {
  const code = usePendingCodeStore((s) => s.code);
  const [check, setCheck] = useState<{ code: string | null; result: CodeCheck }>({
    code: null, result: null,
  });
  useEffect(() => {
    if (code === null) return;
    let alive = true;
    void fetchCodeIntro(code).then((r) => {
      if (alive) setCheck({ code, result: r });
    });
    return () => {
      alive = false;
    };
  }, [code]);
  // An answer about an earlier code is no answer about this one.
  return code !== null && check.code === code ? check.result : 'checking';
}

// usePickerIntro —— what the name picker shows: the code's intro (null: unreadable), or undefined
// while there is nothing to show — no pending code, no answer yet, or a code the backend refuses.
// A refused code (revoked / expired / unknown) is dropped, so no "ACCESS GRANTED" is ever shown for
// it (sijie.xyz, 2026-10-05). A visitor whose code is gone is a public visitor: the page loads again
// without it (the absorb already took ?code= out of the address), so `/` is the owner's home page,
// answering on the public tier where the owner has one.
export function usePickerIntro(): CodeIntro | null | undefined {
  const check = useCodeIntro();
  const closed = check === 'closed';
  useEffect(() => {
    if (!closed) return;
    usePendingCodeStore.getState().consume();
    window.location.replace(window.location.pathname);
  }, [closed]);
  return check === 'closed' || check === 'checking' ? undefined : check;
}
