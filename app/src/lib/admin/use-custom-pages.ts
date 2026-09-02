// use-custom-pages —— state for /admin/custom-pages.

'use client';

import { useEffect, useRef } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { APIError } from '@/lib/api/api-error';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

const CustomPageSummarySchema = z.object({
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
  created_at: z.string(), updated_at: z.string(),
});
export type CustomPageSummary = z.infer<typeof CustomPageSummarySchema>;

// PreviewView —— the three values the preview block needs.
export interface PreviewView {
  src: string;
  buildID: string;
  status: string;
}

// previewView —— where each of the three optional fields resolves to. Lives
// in lib, not the component: the presentation layer's branching cap is 3, and three `??` already fill it — judgment lives here, the component only lays it out.
export function previewView(page: CustomPageSummary): PreviewView {
  return {
    src: page.preview_url ?? '',
    buildID: page.latest_build_id ?? '',
    status: page.latest_build_status ?? '',
  };
}

// usePinnedPreviewSrc —— the preview iframe's src, pinned to buildID.
//
// The token in preview_url is signed fresh by the backend on every request
// (time.Now()), and this page polls every 3 seconds — so the same build's
// src gets a new token every 3 seconds. The iframe's key stays stable, but
// the moment src changes, React updates the src attribute → the whole
// iframe reloads, and the owner watches the preview flicker every 3 seconds.
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

export type CustomPagesBodyState = 'loading' | 'error' | 'empty' | 'list';

export interface CustomPagesHook {
  status: ResourceStatus;
  rows: readonly CustomPageSummary[];
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
}

export const customPagesStore = createResourceStore<CustomPageSummary[]>({
  name: 'custom-pages',
  fetcher: () => adminAPI.get('/custom-pages', z.array(CustomPageSummarySchema)),
});

// pollEveryMs —— the owner gives instructions **elsewhere** (on the Claude
// side), so this page has no event to wait on and can only ask. 3 seconds:
// one build takes tens of seconds, and this interval is short enough for
// "it started building / it's built" to show up promptly, without turning
// the panel into a refresh machine.
//
// SSE would be cheaper, but that means the backend opening another push
// channel — and there's no second consumer on this path, so building
// another channel now would be paying for a need that doesn't exist yet.
const pollEveryMs = 3_000;

export function useCustomPages(): CustomPagesHook {
  const r = useResource(customPagesStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  // The owner is often directing an agent to change this in another window
  // when they open this page. Without polling, they'd have to refresh
  // manually to see it — and "I have to refresh it myself" is exactly what they complained about.
  useEffect(() => {
    const t = setInterval(() => { void customPagesStore.getState().refresh(); }, pollEveryMs);
    return () => clearInterval(t);
  }, []);
  return {
    status: r.status, rows: r.data ?? [], error: r.error,
    refresh: customPagesStore.getState().refresh,
    createPage, writeFile, build, getBuild, promote, setByoai, rollback, removePage,
  };
}

// A mutation always throws, finished up by the caller with useAction
// (success toast / failure report) — if it were swallowed into false, "the
// build never ran" and "the build ran but failed" would be indistinguishable on screen.
async function createPage(slug: string, title: string): Promise<void> {
  await adminAPI.post('/custom-pages/', { slug, title }, z.object({ slug: z.string() }));
  await customPagesStore.getState().refresh();
}

async function writeFile(slug: string, path: string, content: string): Promise<void> {
  await adminAPI.put(`/custom-pages/${slug}/files`, { path, content }, z.object({}).passthrough());
}

async function build(slug: string): Promise<BuildView> {
  return adminAPI.post(`/custom-pages/${slug}/build`, {}, BuildSchema);
}

async function getBuild(buildID: string): Promise<BuildView> {
  return adminAPI.get(`/custom-pages/builds/${buildID}`, BuildSchema);
}

async function promote(slug: string, buildID: string): Promise<void> {
  await adminAPI.post(`/custom-pages/${slug}/live`, { build_id: buildID },
    z.object({}).passthrough());
  await customPagesStore.getState().refresh();
}

// publishPage —— the whole sequence: create → write → build → poll → go live only on success.
//
// Lives at this layer, not the component: **the build is async**, and
// deciding "running / succeeded / failed" is logic, not presentation. onTick
// hands each poll's result back, because what the owner needs to see is
// exactly "it's still running" — a button that does nothing when clicked
// looks identical on screen to a failed build.
export async function publishPage(
  slug: string, source: string, onTick: (b: BuildView) => void,
): Promise<BuildView> {
  await ensurePage(slug);
  await writeFile(slug, 'App.tsx', source);
  const started = await build(slug);
  onTick(started);
  const settled = await pollBuild(started.build_id, onTick);
  await promoteIfBuilt(slug, settled);
  return settled;
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
  await adminAPI.post(`/custom-pages/${slug}/rollback`, {}, z.object({}).passthrough());
  await customPagesStore.getState().refresh();
}

async function removePage(slug: string): Promise<void> {
  await adminAPI.deleteVoid(`/custom-pages/${slug}`);
  await customPagesStore.getState().refresh();
}

async function setByoai(slug: string, allow: boolean): Promise<void> {
  await adminAPI.put(`/custom-pages/${slug}/byoai`, { allow_byoai: allow },
    z.object({}).passthrough());
  await customPagesStore.getState().refresh();
}

export function pickCustomPagesBodyState(hook: CustomPagesHook): CustomPagesBodyState {
  // Once there's data, the list keeps showing — the 3-second poll flips
  // status to 'loading' every time, and if the list were swapped for a
  // skeleton then, the whole row (preview iframe included) would unmount and
  // remount every 3 seconds → the preview flickering and reloading every 3
  // seconds (pentest / owner feedback 2026-09-01). The skeleton belongs only
  // to the **first load** (before any data exists); a background refresh shouldn't interrupt what's already being viewed.
  if (hook.rows.length > 0) return 'list';
  if (hook.status === 'idle' || hook.status === 'loading') return 'loading';
  if (hook.status === 'error') return 'error';
  return 'empty';
}
