// use-debounced-saved-label —— the "saved / saving…" indicator in the
// ResumeComposer top bar. model changes → "moments ago"; unchanged for
// 600ms → "saved". Components must not run useEffect control flow
// (presentation-layer rule), so this is pulled out into lib/.

import { useEffect, useState } from 'react';

export function useDebouncedSavedLabel(dep: unknown): string {
  const [label, setLabel] = useState('saved');
  useEffect(() => {
    setLabel('moments ago');
    const t = setTimeout(() => setLabel('saved'), 600);
    return () => clearTimeout(t);
  }, [dep]);
  return label;
}
