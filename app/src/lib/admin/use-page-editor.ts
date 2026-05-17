// use-page-editor —— /admin/page 的状态机。
//
// 流程：mount → GET /api/admin/page → loaded → 用户改 hero_prose → dirty=true →
// 点 save → PUT → 回 loaded with dirty=false + savedAt 时间戳。

import { useCallback, useEffect, useRef, useState } from 'react';

import { adminAPI, type PageContent } from '@/lib/api/admin';

type Loading = { kind: 'loading' };
type Loaded = { kind: 'loaded'; content: PageContent; dirty: boolean; savedAt: number | null };
type Saving = { kind: 'saving' };
type LoadError = { kind: 'error'; message: string };
export type PageEditorState = Loading | Loaded | Saving | LoadError;

export interface PageEditorHook {
  state: PageEditorState;
  setHeroProse: (v: string) => void;
  save: () => Promise<void>;
}

export function usePageEditor(): PageEditorHook {
  const [state, setState] = useState<PageEditorState>({ kind: 'loading' });
  const contentRef = useRef<PageContent | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadInitial(cancelled, setState, contentRef);
    return () => { cancelled = true; };
  }, []);

  const setHeroProse = useCallback((v: string) => {
    const next = contentRef.current && { ...contentRef.current, hero_prose: v };
    next && (contentRef.current = next);
    setState((s) => updateHeroProse(s, v));
  }, []);

  const save = useCallback(async () => {
    const payload = contentRef.current;
    payload && (await runSave(payload, setState, contentRef));
  }, []);

  return { state, setHeroProse, save };
}

async function loadInitial(
  cancelled: boolean,
  setState: (s: PageEditorState) => void,
  contentRef: React.MutableRefObject<PageContent | null>,
): Promise<void> {
  try {
    const content = await adminAPI.get<PageContent>('/page');
    if (cancelled) return;
    contentRef.current = content;
    setState({ kind: 'loaded', content, dirty: false, savedAt: null });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'load failed';
    cancelled || setState({ kind: 'error', message });
  }
}

function updateHeroProse(s: PageEditorState, v: string): PageEditorState {
  return s.kind === 'loaded'
    ? { kind: 'loaded', content: { ...s.content, hero_prose: v }, dirty: true, savedAt: s.savedAt }
    : s;
}

async function runSave(
  payload: PageContent,
  setState: (s: PageEditorState) => void,
  contentRef: React.MutableRefObject<PageContent | null>,
): Promise<void> {
  setState({ kind: 'saving' });
  try {
    const saved = await adminAPI.put<PageContent>('/page', payload);
    contentRef.current = saved;
    setState({ kind: 'loaded', content: saved, dirty: false, savedAt: Date.now() });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'save failed';
    setState({ kind: 'error', message });
  }
}
