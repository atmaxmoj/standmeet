// use-page-editor —— /admin/page 的状态机。
//
// zustand 重构：server baseline（GET /api/admin/page）走全应用共享的
// pageContentStore（[[create-resource-store]] factory，跟 sessionStore /
// codesStore 同形状）。form 状态（mutable copy + dirty + savedAt）仍是
// per-component local useState —— 跟 use-byoai 的 pattern 对齐：编辑流是
// per-form 的，不该上 global store。
//
// 保留对外 PageEditorState 离散联合 (loading|loaded|saving|error)，让
// PageSection 不用改。
//
// save 路径仍调 PUT /page，整段 content 上传；成功后把新 baseline
// `mutate` 进 store cache，避免再 GET 一次。

import { useCallback, useEffect, useState } from 'react';

import { adminAPI, type AdminPage } from '@/lib/api/admin';
import { AdminPageSchema } from '@/lib/api/public-schemas';
import { pageContentStore } from '@/lib/admin/page-content-store';
import { useResource } from '@/lib/state/create-resource-store';

// 把 readonly 字段转成可写副本，状态机内部需要 patch。深度脱 readonly。
// insights/projects 是 corpus pin 列表(wiki id) —— pin manager 增删/排序,
// 不再自由文本编辑(内容只存一份,在 corpus 里)。
export interface MutableWhere   { location_line: string; status_prose: string; closing: string; looking_for: string[] }
export interface MutableContact { email: string; chat_line: string; recruiter_prose: string; casual_prose: string }

export interface MutablePage {
  updated_at: string;
  owner_id: string;
  hero_prose: string;
  hero_examples: string[];
  insights: string[];
  projects: string[];
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

interface FormState {
  content: MutablePage;
  baselineUpdatedAt: string;
  dirty: boolean;
  savedAt: number | null;
}

export function usePageEditor(): PageEditorHook {
  const resource = useResource(pageContentStore);
  const ensureLoaded = resource.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);

  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 当 store 第一次 ready，或 server baseline 换了（mutate 之后 updated_at
  // 变），seed/reseed 本地 form。已经在编辑的 form 不被打断 —— 用
  // baselineUpdatedAt 当 "我已经基于这版做了哪些改" 的指纹。
  useEffect(() => {
    if (resource.status === 'ready' && resource.data) {
      const incoming = resource.data;
      setForm((cur) => cur && cur.baselineUpdatedAt === incoming.updated_at
        ? cur
        : { content: toMutable(incoming), baselineUpdatedAt: incoming.updated_at, dirty: false, savedAt: cur?.savedAt ?? null });
    }
  }, [resource.status, resource.data]);

  const setHeroProse = useCallback((v: string) => {
    setForm((f) => f ? { ...f, content: { ...f.content, hero_prose: v }, dirty: true } : f);
  }, []);

  const patch = useCallback((p: Partial<MutablePage>) => {
    setForm((f) => f ? { ...f, content: { ...f.content, ...p }, dirty: true } : f);
  }, []);

  const save = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      setForm((f) => {
        if (!f) { resolve(); return f; }
        void runSave(f.content, setForm, setSaving, setSaveError).then(resolve);
        return f;
      });
    });
  }, []);

  const revert = useCallback(() => {
    const baseline = pageContentStore.getState().data;
    if (!baseline) return;
    setForm({
      content: toMutable(baseline),
      baselineUpdatedAt: baseline.updated_at,
      dirty: false,
      savedAt: null,
    });
  }, []);

  return {
    state: deriveState(resource.status, resource.error, form, saving, saveError),
    setHeroProse, patch, save, revert,
  };
}

function deriveState(
  status: 'idle' | 'loading' | 'ready' | 'error',
  resourceErr: string | null,
  form: FormState | null,
  saving: boolean,
  saveError: string | null,
): PageEditorState {
  if (saving) return { kind: 'saving' };
  if (saveError) return { kind: 'error', message: saveError };
  if (status === 'error' || resourceErr) {
    return { kind: 'error', message: resourceErr ?? 'load failed' };
  }
  if (!form) return { kind: 'loading' };
  return { kind: 'loaded', content: form.content, dirty: form.dirty, savedAt: form.savedAt };
}

async function runSave(
  payload: MutablePage,
  setForm: (next: FormState | ((cur: FormState | null) => FormState | null)) => void,
  setSaving: (b: boolean) => void,
  setErr: (m: string | null) => void,
): Promise<void> {
  setSaving(true);
  setErr(null);
  try {
    const saved = await adminAPI.put('/page', payload, AdminPageSchema);
    pageContentStore.getState().mutate(saved);
    setForm({
      content: toMutable(saved),
      baselineUpdatedAt: saved.updated_at,
      dirty: false,
      savedAt: Date.now(),
    });
  } catch (e) {
    setErr(e instanceof Error ? e.message : 'save failed');
  } finally {
    setSaving(false);
  }
}

function toMutable(c: AdminPage): MutablePage {
  return {
    updated_at: c.updated_at,
    owner_id: c.owner_id,
    hero_prose: c.hero_prose,
    hero_examples: [...c.hero_examples],
    insights: [...c.insights],
    projects: [...c.projects],
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
