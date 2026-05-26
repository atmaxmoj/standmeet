// use-debounced-saved-label —— ResumeComposer 顶栏 "saved / saving…" 指示。
// model 变 → "moments ago"; 600ms 不变 → "saved"。
// component 不准跑 useEffect 控制流（presentation 规约），所以抽到 lib/。

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
