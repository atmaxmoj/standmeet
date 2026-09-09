// use-microsites —— state for /admin/microsites.

'use client';

import { useEffect, useRef } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { APIError } from '@/lib/api/api-error';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';
import { useLongPoll } from '@/lib/long-poll/use-long-poll';

const MicrositeSummarySchema = z.object({
  id: z.string(), slug: z.string(), title: z.string(), status: z.string(),
  has_live: z.boolean(), has_staging: z.boolean(), live_build_id: z.string().optional(),
  // bound_codes —— which codes open this page (the other end of the
  // binding). nullish so an old backend doesn't crash the whole list
  // ([[zod-unknown-is-not-optional]]: a missing field from the server silently fails the whole schema).
  bound_codes: z.array(z.string()).nullish(),
  allow_byoai: z.boolean().nullish(),
  // latest_build_id —— the panel uses this to decide "the preview should
  // refresh now": the agent produces a new id on every build, the only value
  // that changes along with what the owner directs. optional: the backend
  // has omitempty, and a missing field shouldn't crash the whole list ([[zod-unknown-is-not-optional]]).
  latest_build_id: z.string().optional(),
  latest_build_status: z.string().optional(),
  // preview_url —— the src for the panel's iframe, with the token already
  // signed into it. **Never assembled on the frontend**: the token needs the
  // server's key, and an address the frontend assembles on its own is bound
  // to drift from the server's format eventually — after which the preview goes blank with nothing erroring.
  preview_url: z.string().optional(),
  // seo_title / seo_description —— per-page SEO the editor shows + edits. optional so an old
  // backend (no columns) doesn't fail the whole list ([[zod-unknown-is-not-optional]]).
  seo_title: z.string().optional(),
  seo_description: z.string().optional(),
  seo_image: z.string().optional(),
  created_at: z.string(), updated_at: z.string(),
});
export type MicrositeSummary = z.infer<typeof MicrositeSummarySchema>;

// PreviewView —— the three values the preview block needs.
export interface PreviewView {
  src: string;
  buildID: string;
  status: string;
}

// previewView —— where each of the three optional fields resolves to. Lives
// in lib, not the component: the presentation layer's branching cap is 3, and three `??` already fill it — judgment lives here, the component only lays it out.
export function previewView(page: MicrositeSummary): PreviewView {
  return {
    src: page.preview_url ?? '',
    buildID: page.latest_build_id ?? '',
    status: page.latest_build_status ?? '',
  };
}

// previewIsLive —— the preview pane always shows the LATEST build; that build IS the live one only
// when its id equals the live build id. Otherwise the preview is a staging build not yet promoted
// (or the page was never made live). This drives the pane's live/staging caption — the caption used
// to be a hardcoded "not yet live", which lied whenever the previewed build was already the live one.
export function previewIsLive(page: MicrositeSummary): boolean {
  const latest = page.latest_build_id ?? '';
  return latest !== '' && latest === page.live_build_id;
}

// usePinnedPreviewSrc —— the preview iframe's src, pinned to buildID.
//
// The token in preview_url is signed fresh by the backend on every request
// (time.Now()), and the list is refetched on every long-poll return — so the
// same build's src gets a new token each time. The iframe's key stays stable,
// but the moment src changes, React updates the src attribute → the whole
// iframe reloads, and the owner watches the preview flicker on every refetch.
// This only swaps src when buildID actually changes (a new build has
// landed); token churn leaves it alone. The logic lives in lib, not the
// component, because the presentation layer bans if (complexity capped at 3).
export function usePinnedPreviewSrc(buildID: string, src: string): string {
  const pinned = useRef({ buildID: '', src: '' });
  if (buildID !== '' && buildID !== pinned.current.buildID) {
    pinned.current = { buildID, src };
  }
  return pinned.current.src;
}

const BuildSchema = z.object({
  build_id: z.string(), status: z.string(), error_message: z.string().nullish(),
});
export type BuildView = z.infer<typeof BuildSchema>;

export type MicrositesBodyState = 'loading' | 'error' | 'empty' | 'list';

export interface MicrositesHook {
  status: ResourceStatus;
  rows: readonly MicrositeSummary[];
  error: string | null;
  refresh: () => Promise<void>;
  createPage: (slug: string, title: string) => Promise<void>;
  writeFile: (slug: string, path: string, content: string) => Promise<void>;
  build: (slug: string) => Promise<BuildView>;
  getBuild: (buildID: string) => Promise<BuildView>;
  promote: (slug: string, buildID: string) => Promise<void>;
  setByoai: (slug: string, allow: boolean) => Promise<void>;
  rollback: (slug: string) => Promise<void>;
  removePage: (slug: string) => Promise<void>;
  renamePage: (slug: string, newSlug: string) => Promise<void>;
  setSEO: (slug: string, title: string, description: string, image: string) => Promise<void>;
}

export const micrositesStore = createResourceStore<MicrositeSummary[]>({
  name: 'microsites',
  fetcher: () => adminAPI.get('/microsites', z.array(MicrositeSummarySchema)),
});

export function useMicrosites(): MicrositesHook {
  const r = useResource(micrositesStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  // The owner is often directing an agent to change this page in another window. A held long-poll
  // (GET /microsites/wait answers the instant a build settles, cursor = version) makes the panel
  // follow those builds live without a manual refresh. It runs in a WORKER so the held socket never
  // sits on the main thread's connections and blocks navigation — terminating the worker on unmount
  // (inside useLongPoll) kills the held request instantly ([[long-poll-worker-infra]]).
  useLongPoll({ url: '/api/admin/microsites/wait' }, () => { void micrositesStore.getState().refresh(); });
  return {
    status: r.status, rows: r.data ?? [], error: r.error,
    refresh: micrositesStore.getState().refresh,
    createPage, writeFile, build, getBuild, promote, setByoai, rollback, removePage, renamePage,
    setSEO,
  };
}

// A mutation always throws, finished up by the caller with useAction
// (success toast / failure report) — if it were swallowed into false, "the
// build never ran" and "the build ran but failed" would be indistinguishable on screen.
async function createPage(slug: string, title: string): Promise<void> {
  await adminAPI.post('/microsites/', { slug, title }, z.object({ slug: z.string() }));
  await micrositesStore.getState().refresh();
}

// renamePage — change the page's slug (its /p/<slug> address). Bound codes follow by id; the
// caller navigates to the new editor route on success.
async function renamePage(slug: string, newSlug: string): Promise<void> {
  await adminAPI.put(`/microsites/${slug}/slug`, { new_slug: newSlug }, z.object({}).passthrough());
  await micrositesStore.getState().refresh();
}

// seoInit — a page's current SEO values as plain strings (the editor's initial field state). In
// lib so the SeoPanel component stays under the presentation-layer branching cap (three `??`).
export function seoInit(row: MicrositeSummary): { title: string; desc: string; image: string } {
  return {
    title: row.seo_title ?? '',
    desc: row.seo_description ?? '',
    image: row.seo_image ?? '',
  };
}

// setSEO — set this page's per-page SEO (title + description + OG/share-card image), injected into
// the served <head>.
async function setSEO(slug: string, title: string, description: string, image: string): Promise<void> {
  await adminAPI.put(`/microsites/${slug}/seo`,
    { seo_title: title, seo_description: description, seo_image: image },
    z.object({}).passthrough());
  await micrositesStore.getState().refresh();
}

async function writeFile(slug: string, path: string, content: string): Promise<void> {
  await adminAPI.put(`/microsites/${slug}/files`, { path, content }, z.object({}).passthrough());
}

async function build(slug: string): Promise<BuildView> {
  return adminAPI.post(`/microsites/${slug}/build`, {}, BuildSchema);
}

async function getBuild(buildID: string): Promise<BuildView> {
  return adminAPI.get(`/microsites/builds/${buildID}`, BuildSchema);
}

async function promote(slug: string, buildID: string): Promise<void> {
  await adminAPI.post(`/microsites/${slug}/live`, { build_id: buildID },
    z.object({}).passthrough());
  await micrositesStore.getState().refresh();
}

// DraftFiles — the editor's file bundle: path → source. The mini-IDE loads it (loadDraft), edits
// several files, and stages/ships the whole bundle at once (stageFiles / shipFilesLive).
const DraftFilesSchema = z.object({ files: z.record(z.string(), z.string()) });
export type DraftFiles = Record<string, string>;

// loadDraft — the page's current draft files, for the editor to open an existing page.
export async function loadDraft(slug: string): Promise<DraftFiles> {
  const { files } = await adminAPI.get(`/microsites/${slug}/files`, DraftFilesSchema);
  return files;
}

// stageFiles — create-if-needed → write EACH file → build → poll. The multi-file generalisation of
// stagePage (which is now just the one-file case).
export async function stageFiles(
  slug: string, files: DraftFiles, onTick: (b: BuildView) => void,
): Promise<BuildView> {
  await ensurePage(slug);
  for (const [path, content] of Object.entries(files)) {
    await writeFile(slug, path, content);
  }
  const started = await build(slug);
  onTick(started);
  const settled = await pollBuild(started.build_id, onTick);
  await micrositesStore.getState().refresh();
  return settled;
}

// shipFilesLive — publish the whole bundle. Reuses an already-built staging build when present.
export async function shipFilesLive(
  slug: string, files: DraftFiles, staged: BuildView | null, onTick: (b: BuildView) => void,
): Promise<void> {
  if (staged?.status === 'built') {
    await promote(slug, staged.build_id);
    return;
  }
  const settled = await stageFiles(slug, files, onTick);
  await promoteIfBuilt(slug, settled);
}

// ensurePage —— the first step of the publish sequence is "**does this page
// exist**", not "create a new page".
//
// The most common thing on this screen is revising and republishing. The
// previous version hardcoded createPage as step one, so publishing the same
// slug a second time hit a 409 and the whole sequence stopped right there:
// the source never got written, the build never ran, production stayed old
// — the panel's one and only button **never worked** on an already-existing page (F-P-2).
//
// Only a 409 is swallowed. Every other failure is still rethrown: treating a
// 500 as "it already exists" would send the subsequent write and build
// against a page that doesn't exist, and the owner would just see an unexplainable build failure.
async function ensurePage(slug: string): Promise<void> {
  try {
    await createPage(slug, slug);
  } catch (e) {
    if (!(e instanceof APIError) || e.status !== 409) throw e;
  }
}

async function pollBuild(id: string, onTick: (b: BuildView) => void): Promise<BuildView> {
  for (;;) {
    await new Promise((r) => { setTimeout(r, POLL_MS); });
    const row = await getBuild(id);
    onTick(row);
    if (row.status === 'built' || row.status === 'failed') return row;
  }
}

// promoteIfBuilt —— goes live only on a successful build. **A failure must
// never touch production**: a failed build replacing a page already in service would be the worst kind of "success".
async function promoteIfBuilt(slug: string, settled: BuildView): Promise<void> {
  if (settled.status !== 'built') return;
  await promote(slug, settled.build_id);
}

const POLL_MS = 1500;

// rollback / removePage —— **taking something down**. If the owner can
// publish from the panel, they must be able to unpublish from the panel too:
// without these two, the rule "admin takes it down, visitors lose access" is
// simply unenforceable from the panel — the owner would have to open a
// Claude session and call MCP just to take down something they just published (F-P-4).
//
// rollback only unpublishes (the build still exists, can go live again);
// delete removes the whole page. The two actions are kept separate because
// their consequences are different.
async function rollback(slug: string): Promise<void> {
  await adminAPI.post(`/microsites/${slug}/rollback`, {}, z.object({}).passthrough());
  await micrositesStore.getState().refresh();
}

async function removePage(slug: string): Promise<void> {
  await adminAPI.deleteVoid(`/microsites/${slug}`);
  await micrositesStore.getState().refresh();
}

async function setByoai(slug: string, allow: boolean): Promise<void> {
  await adminAPI.put(`/microsites/${slug}/byoai`, { allow_byoai: allow },
    z.object({}).passthrough());
  await micrositesStore.getState().refresh();
}

// rows defaults to hook.rows, but the section passes the homepage-filtered rows: the homepage is
// pulled out into its own card, so an instance with only a `home` page has an empty *table* and
// must show the empty state, not a list with the home row stripped out to nothing.
export function pickMicrositesBodyState(
  hook: MicrositesHook,
  rows: readonly MicrositeSummary[] = hook.rows,
): MicrositesBodyState {
  // Once there's data, the list keeps showing — a background refresh flips
  // status to 'loading', and if the list were swapped for a skeleton then, the
  // whole row (preview iframe included) would unmount and remount → the preview
  // flickering and reloading on every refetch (pentest / owner feedback
  // 2026-09-01). The skeleton belongs only to the **first load** (before any
  // data exists); a background refresh shouldn't interrupt what's already being viewed.
  if (rows.length > 0) return 'list';
  if (hook.status === 'idle' || hook.status === 'loading') return 'loading';
  if (hook.status === 'error') return 'error';
  return 'empty';
}
