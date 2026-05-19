// use-page-editor —— /admin/page 的状态机。
//
// 流程：mount → GET /api/admin/page → loaded → 用户改 hero_prose 等字段 →
// dirty=true → 点 save → PUT → loaded with dirty=false + savedAt 时间戳。
//
// 多 block 支持：除 hero_prose 之外的字段（insights / projects / where /
// contact / hero_examples）只在 client side 改，save 路径仍调 PUT /page，
// 后端如果保留其他字段就完整持久；如果只接 hero_prose，其它字段在重 fetch
// 时会丢——目前 PUT /api/admin/page payload 就是整个 content。

import { useCallback, useEffect, useRef, useState } from 'react';

import { adminAPI, type PageContent } from '@/lib/api/admin';

// 把 readonly 字段转成可写副本，状态机内部需要 patch。深度脱 readonly。
export interface MutableInsight { id: string; thesis: string; context: string; body: string }
export interface MutableProject { id: string; name: string; tagline: string; lines: string[]; url?: string | null }
export interface MutableWhere   { location_line: string; status_prose: string; closing: string; looking_for: string[] }
export interface MutableContact { email: string; chat_line: string; recruiter_prose: string; casual_prose: string }

export interface MutablePage {
  updated_at: string;
  owner_id: string;
  hero_prose: string;
  hero_examples: string[];
  insights: MutableInsight[];
  projects: MutableProject[];
  where: MutableWhere;
  contact: MutableContact;
}

type Loading = { kind: 'loading' };
type Loaded = { kind: 'loaded'; content: MutablePage; dirty: boolean; savedAt: number | null };
type Saving = { kind: 'saving' };
type LoadError = { kind: 'error'; message: string };
export type PageEditorState = Loading | Loaded | Saving | LoadError;

export interface PageEditorHook {
  state: PageEditorState;
  setHeroProse: (v: string) => void;
  patch: (p: Partial<MutablePage>) => void;
  save: () => Promise<void>;
  revert: () => void;
}

export function usePageEditor(): PageEditorHook {
  const [state, setState] = useState<PageEditorState>({ kind: 'loading' });
  const originalRef = useRef<PageContent | null>(null);
  const contentRef = useRef<MutablePage | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadInitial(cancelled, setState, originalRef, contentRef);
    return () => { cancelled = true; };
  }, []);

  const setHeroProse = useCallback((v: string) => {
    contentRef.current && (contentRef.current = { ...contentRef.current, hero_prose: v });
    setState((s) => applyDirty(s, { hero_prose: v }));
  }, []);

  const patch = useCallback((p: Partial<MutablePage>) => {
    contentRef.current && (contentRef.current = { ...contentRef.current, ...p });
    setState((s) => applyDirty(s, p));
  }, []);

  const save = useCallback(async () => {
    const payload = contentRef.current;
    payload && (await runSave(payload, setState, originalRef, contentRef));
  }, []);

  const revert = useCallback(() => {
    const orig = originalRef.current;
    orig && (contentRef.current = toMutable(orig));
    setState((s) => orig ? { kind: 'loaded', content: toMutable(orig), dirty: false, savedAt: s.kind === 'loaded' ? s.savedAt : null } : s);
  }, []);

  return { state, setHeroProse, patch, save, revert };
}

async function loadInitial(
  cancelled: boolean,
  setState: (s: PageEditorState) => void,
  originalRef: React.MutableRefObject<PageContent | null>,
  contentRef: React.MutableRefObject<MutablePage | null>,
): Promise<void> {
  try {
    const content = await adminAPI.get<PageContent>('/page');
    if (cancelled) return;
    originalRef.current = content;
    contentRef.current = toMutable(content);
    setState({ kind: 'loaded', content: contentRef.current, dirty: false, savedAt: null });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'load failed';
    cancelled || setState({ kind: 'error', message });
  }
}

function applyDirty(s: PageEditorState, p: Partial<MutablePage>): PageEditorState {
  return s.kind === 'loaded'
    ? { kind: 'loaded', content: { ...s.content, ...p }, dirty: true, savedAt: s.savedAt }
    : s;
}

async function runSave(
  payload: MutablePage,
  setState: (s: PageEditorState) => void,
  originalRef: React.MutableRefObject<PageContent | null>,
  contentRef: React.MutableRefObject<MutablePage | null>,
): Promise<void> {
  setState({ kind: 'saving' });
  try {
    const saved = await adminAPI.put<PageContent>('/page', payload);
    originalRef.current = saved;
    contentRef.current = toMutable(saved);
    setState({ kind: 'loaded', content: contentRef.current, dirty: false, savedAt: Date.now() });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'save failed';
    setState({ kind: 'error', message });
  }
}

function toMutable(c: PageContent): MutablePage {
  return {
    updated_at: c.updated_at,
    owner_id: c.owner_id,
    hero_prose: c.hero_prose,
    hero_examples: [...c.hero_examples],
    insights: c.insights.map((i) => ({ id: i.id, thesis: i.thesis, context: i.context, body: i.body })),
    projects: c.projects.map((p) => ({
      id: p.id, name: p.name, tagline: p.tagline,
      lines: [...p.lines], url: p.url ?? '',
    })),
    where: {
      location_line: c.where.location_line, status_prose: c.where.status_prose,
      closing: c.where.closing, looking_for: [...c.where.looking_for],
    },
    contact: {
      email: c.contact.email, chat_line: c.contact.chat_line,
      recruiter_prose: c.contact.recruiter_prose, casual_prose: c.contact.casual_prose,
    },
  };
}
