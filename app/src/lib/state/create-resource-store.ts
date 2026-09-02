// create-resource-store —— generic "single async fetch + cached" store factory.
//
// 13 hooks used to each roll their own useState + useEffect + try/catch;
// this factory unifies them:
//
//   const useCodesStore = createResourceStore<CodeView[]>({
//     name: 'codes',
//     fetcher: () => adminAPI.get('/codes/'),
//   });
//
//   // component:
//   const { data, status, error, ensureLoaded, refresh } = useCodesStore();
//   useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
//
// Plays well with react/forbid-component-props style lint, no nolint exceptions.
// ensureLoaded —— only runs the fetch when status==='idle'; safe across
// multiple mounts / strict-mode double render.
// refresh —— forces a re-fetch (used after a mutation to get fresh data).

import { useEffect } from 'react';
import { create, type StoreApi, type UseBoundStore } from 'zustand';

import { APIError } from '@/lib/api/api-error';
import { logger } from '@/lib/logger';
import type { ResourceShape, ResourceStatus } from '@/lib/state/status';

export interface ResourceStore<T> extends ResourceShape<T> {
  ensureLoaded: () => Promise<void>;
  refresh: () => Promise<void>;
  // mutate —— optimistic update; the caller computes the new data and pushes
  // it straight in, and the next refresh pulls the real state to reconcile.
  mutate: (next: T | ((prev: T | undefined) => T)) => void;
  // reset —— puts the store back to idle (used for sign out / instance reset etc.).
  reset: () => void;
}

export interface CreateResourceStoreOpts<T> {
  // name —— used only by the logger, so an error can be traced to which store reported it.
  name: string;
  fetcher: () => Promise<T>;
}

type Setter<T> = StoreApi<ResourceStore<T>>['setState'];

type Getter<T> = StoreApi<ResourceStore<T>>['getState'];

export function createResourceStore<T>(
  opts: CreateResourceStoreOpts<T>,
): UseBoundStore<StoreApi<ResourceStore<T>>> {
  return create<ResourceStore<T>>((set, get: Getter<T>) => ({
    status: 'idle' satisfies ResourceStatus,
    data: undefined,
    error: null,
    errorStatus: null,
    lastFetched: null,

    ensureLoaded: async () => {
      if (get().status !== 'idle') return;
      await runFetch(opts, set);
    },
    refresh: async () => {
      await runFetch(opts, set);
    },
    mutate: (next) => {
      set((s) => ({ ...s, data: applyMutate(s.data, next) }));
    },
    reset: () => set({
      status: 'idle', data: undefined, error: null, errorStatus: null, lastFetched: null,
    }),
  }));
}

async function runFetch<T>(opts: CreateResourceStoreOpts<T>, set: Setter<T>): Promise<void> {
  set((s) => ({ ...s, status: 'loading', error: null, errorStatus: null }));
  try {
    const data = await opts.fetcher();
    set({ status: 'ready', data, error: null, errorStatus: null, lastFetched: Date.now() });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'load failed';
    logger.error(`store ${opts.name}: fetch`, e);
    set((s) => ({
      // If there's already data, keep it and just flag error (partial
      // failure). Otherwise fall to the full error state (component shows
      // error UI).
      ...s,
      status: s.data === undefined ? 'error' : 'ready',
      error: message,
      // Keep the status code around — the reader needs to tell 401 (go log
      // in) apart from 5xx (server is down).
      errorStatus: e instanceof APIError ? e.status : null,
    }));
  }
}

type Updater<T> = (prev: T | undefined) => T;

function applyMutate<T>(prev: T | undefined, next: T | Updater<T>): T {
  return isFn(next) ? next(prev) : next;
}

function isFn<T>(v: T | Updater<T>): v is Updater<T> {
  return typeof v === 'function';
}

// useResourceMount —— simplifies the component side: wires ensureLoaded() up
// to mount, so a component just imports one hook and is done, no useEffect boilerplate.
export type UseStoreFor<T> = UseBoundStore<StoreApi<ResourceStore<T>>>;

// useResource —— reads a resource store (and kicks off loading if it's idle).
//
// The name went from `useResource` to `useResource`: it always was a hook
// (it calls zustand's hook internally), and calling it "read" lied to both
// the reader and rules-of-hooks — eslint decides purely from the name. Now
// that it also carries an effect, matching the name to what it does matters even more.
export function useResource<T>(
  store: UseStoreFor<T>,
): ResourceShape<T> & { ensureLoaded: () => Promise<void> } {
  const status = store((s) => s.status);
  const data = store((s) => s.data);
  const error = store((s) => s.error);
  const errorStatus = store((s) => s.errorStatus);
  const lastFetched = store((s) => s.lastFetched);
  const ensureLoaded = store((s) => s.ensureLoaded);
  // idle ⇒ fetch. **Depends on status**, so once reset() puts the store back
  // to idle, this re-arms.
  //
  // This effect lives here, not in each use-X hook, because "forgetting it"
  // gives no signal at all: the UI just spins forever.
  // Real incident: the promote POST was still in flight when the page had
  // already navigated to /admin/output; the list fetch came back first and
  // flipped the store to ready (the tree rendered too), **then** the POST
  // landed and called outputStore.reset() → idle. But each hook's effect
  // depended on `[ensureLoaded]` (a stable identity), so it only ran once —
  // nobody ever fetched again, pickBodyState painted 'idle' as a skeleton,
  // and the list spun forever. The owner sees "stuck", not "broken".
  // Timing decides the outcome: if the POST lands first everything's fine,
  // so it only surfaces under load.
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded, status]);
  return { status, data, error, errorStatus, lastFetched, ensureLoaded };
}

