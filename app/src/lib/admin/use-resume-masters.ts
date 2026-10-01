// use-resume-masters —— résumé masters (docs/design/resume-masters.md): named, persistent résumés
// the drafts start from. The list pages through the one paginator (docs/design/paging.md); the
// writes go to /api/admin/masters and POST /drafts/{id}/save-as-master — the same usecases the
// owner's AI calls through resume.master_*.

import { useEffect, useState } from 'react';
import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { draftToAPIContent, type DraftModel } from '@/lib/admin/draft-model';
import { ResumeContentSchema, toDraftModel } from '@/lib/admin/draft-wire';
import { createPagedStore } from '@/lib/state/create-paged-store';

export const MasterSchema = z.object({
  id: z.string(),
  name: z.string(),
  is_default: z.boolean(),
  from_company: z.string(),
  updated_at: z.string(),
  resume_content: ResumeContentSchema,
});
export type MasterView = z.infer<typeof MasterSchema>;

// mastersPage —— the drafts page's strip. Reload after a create / delete / default change: those move
// rows or badges across pages.
export const mastersPage = createPagedStore({ name: 'masters', path: '/masters/', item: MasterSchema });

// masterModel —— a master opened in the composer: the same DraftModel the editor edits, with no
// job context (a master is not tied to one).
export function masterModel(m: MasterView): DraftModel {
  return toDraftModel({ id: m.id, company: '', role: '', resume_content: m.resume_content });
}

export async function createMaster(name: string): Promise<MasterView> {
  const m = await adminAPI.post('/masters/', { name: name.trim() }, MasterSchema);
  await mastersPage.getState().reload();
  return m;
}

export async function renameMaster(id: string, name: string): Promise<void> {
  const m = await adminAPI.patch(`/masters/${id}`, { name: name.trim() }, MasterSchema);
  mastersPage.getState().patch(id, () => m);
}

export async function setDefaultMaster(id: string): Promise<void> {
  await adminAPI.patch(`/masters/${id}`, { is_default: true }, MasterSchema);
  await mastersPage.getState().reload();
}

export async function deleteMaster(id: string): Promise<void> {
  await adminAPI.deleteVoid(`/masters/${id}`);
  await mastersPage.getState().reload();
}

// saveMasterContent —— the master editor's Save.
export function saveMasterContent(model: DraftModel): Promise<void> {
  return adminAPI.patchVoid(`/masters/${model.id}`, { resume_content: draftToAPIContent(model) });
}

// SaveAsMasterChoice —— the composer's "set as master" decision: overwrite a master, or a new one.
export type SaveAsMasterChoice =
  | { mode: 'overwrite'; masterId: string }
  | { mode: 'new'; name: string; makeDefault: boolean };

export function saveDraftAsMaster(draftId: string, c: SaveAsMasterChoice): Promise<MasterView> {
  const body = c.mode === 'overwrite'
    ? { master_id: c.masterId }
    : { name: c.name.trim(), make_default: c.makeDefault };
  return adminAPI.post(`/drafts/${draftId}/save-as-master`, body, MasterSchema);
}

// BLANK —— the new-draft picker's "start from nothing" choice.
export const BLANK = 'blank';
// DEFAULT —— "the default master, wherever it is": sent as neither master_id nor blank, so the
// server starts the draft from the default master (or blank when there is none). Chosen when the
// default is not among the loaded pages, which a client-side search could never see.
export const DEFAULT = 'default';

// startChoice —— which "start from" radio is checked: the owner's pick, else the master the modal
// was opened on, else the default master when loaded, else the server's default while more pages
// remain, else blank (every master is loaded and none is the default).
export function startChoice(
  picked: string | null, preselect: string, items: readonly MasterView[], hasMore: boolean,
): string {
  const fallback = offerDefault(items, hasMore) ? DEFAULT : BLANK;
  return picked ?? (preselect || (items.find((m) => m.is_default)?.id ?? fallback));
}

// offerDefault —— the default master may exist on a page not loaded yet: offer it by name.
export function offerDefault(items: readonly MasterView[], hasMore: boolean): boolean {
  return hasMore && !items.some((m) => m.is_default);
}

// masterPreviewURL —— the master's PDF (the `v` cache-buster forces a fresh render after a save).
export function masterPreviewURL(id: string, version: number): string {
  return `/api/admin/masters/${id}/preview.pdf?v=${version}`;
}

interface DetailState { master: MasterView | null; error: string | null }

// useMasterDetail —— one master for the master editor.
export function useMasterDetail(id: string): DetailState {
  const [state, setState] = useState<DetailState>({ master: null, error: null });
  useEffect(() => {
    adminAPI.get(`/masters/${id}`, MasterSchema).then(
      (master) => setState({ master, error: null }),
      (e: unknown) => setState({ master: null, error: e instanceof Error ? e.message : 'load master failed' }),
    );
  }, [id]);
  return state;
}
