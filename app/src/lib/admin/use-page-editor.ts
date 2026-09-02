// use-page-editor —— the /admin/page state machine.
//
// zustand refactor: the server baseline (GET /api/admin/page) goes through
// the app-wide shared pageContentStore (the [[create-resource-store]]
// factory, same shape as sessionStore / codesStore). Form state (mutable
// copy + dirty + savedAt) stays as per-component local useState — matching
// the use-byoai pattern: the edit flow is per-form and shouldn't be a global store.
//
// Keeps the external PageEditorState discriminated union
// (loading|loaded|saving|error) so PageSection doesn't need to change.
//
// The save path still calls PUT /page, uploading the whole content; on
// success the new baseline is `mutate`d into the store cache, avoiding another GET.

import { useCallback, useEffect, useState } from 'react';

import { adminAPI, type AdminPage } from '@/lib/api/admin';
import { AdminPageSchema } from '@/lib/api/public-schemas';
import { pageContentStore } from '@/lib/admin/page-content-store';
import { useResource } from '@/lib/state/create-resource-store';

// Converts readonly fields into a writable copy; the state machine needs to
// patch it internally. Strips readonly deeply.
// insights/projects are corpus pin lists (wiki ids) — the pin manager
// adds/removes/reorders them, no more free-text editing (the content is
// stored once, in the corpus).
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

  // Seed/reseed the local form when the store first becomes ready, or when
  // the server baseline changes (updated_at changes after a mutate). A form
  // already being edited isn't interrupted — baselineUpdatedAt is used as the
  // fingerprint for "what changes have I made based on this version".
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
