// create-resource-store —— 通用 "single async fetch + cached" store factory。
//
// 13 个 hook 之前各自一套 useState + useEffect + try/catch；这条工厂统一
// 它们：
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
// 配合 react/forbid-component-props 类的 lint，没 nolint 例外。
// ensureLoaded —— 仅在 status==='idle' 时跑 fetch；mount 多次/strict mode 双
// render 都安全。
// refresh —— 强制重新拉（用于 mutation 之后想拿最新数据）。

import { create, type StoreApi, type UseBoundStore } from 'zustand';

import { logger } from '@/lib/logger';
import type { ResourceShape, ResourceStatus } from '@/lib/state/status';

export interface ResourceStore<T> extends ResourceShape<T> {
  ensureLoaded: () => Promise<void>;
  refresh: () => Promise<void>;
  // mutate —— optimistic 更新；caller 算好新 data 直接灌进去，下一次 refresh
  // 会拉真实状态对齐。
  mutate: (next: T | ((prev: T | undefined) => T)) => void;
  // reset —— 把 store 退回 idle（用于 sign out / instance reset 等场景）。
  reset: () => void;
}

export interface CreateResourceStoreOpts<T> {
  // name —— 仅用于 logger，让出错时知道是哪个 store 报的。
  name: string;
  fetcher: () => Promise<T>;
}

type Setter<T> = StoreApi<ResourceStore<T>>['setState'];
type Getter<T> = StoreApi<ResourceStore<T>>['getState'];

export function createResourceStore<T>(
  opts: CreateResourceStoreOpts<T>,
): UseBoundStore<StoreApi<ResourceStore<T>>> {
  return create<ResourceStore<T>>((set, get) => ({
    status: 'idle' satisfies ResourceStatus,
    data: undefined,
    error: null,
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
    reset: () => set({ status: 'idle', data: undefined, error: null, lastFetched: null }),
  }));
}

async function runFetch<T>(opts: CreateResourceStoreOpts<T>, set: Setter<T>): Promise<void> {
  set((s) => ({ ...s, status: 'loading', error: null }));
  try {
    const data = await opts.fetcher();
    set({ status: 'ready', data, error: null, lastFetched: Date.now() });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'load failed';
    logger.error(`store ${opts.name}: fetch`, e);
    set((s) => ({
      // 如果之前已经有 data，保留它，只标 error（partial-failure）。否则掉成
      // 完整 error 态（component 显示错误 UI）。
      ...s,
      status: s.data === undefined ? 'error' : 'ready',
      error: message,
    }));
  }
}

function applyMutate<T>(prev: T | undefined, next: T | ((prev: T | undefined) => T)): T {
  return typeof next === 'function'
    ? (next as (p: T | undefined) => T)(prev)
    : next;
}

// useResourceMount —— 简化 component side：把 ensureLoaded() 接到 mount，
// 让 component 只 import 一个 hook 就完事，不写 useEffect 模板。
export type UseStoreFor<T> = UseBoundStore<StoreApi<ResourceStore<T>>>;

export function readResource<T>(
  store: UseStoreFor<T>,
): ResourceShape<T> & { ensureLoaded: () => Promise<void> } {
  const status = store((s) => s.status);
  const data = store((s) => s.data);
  const error = store((s) => s.error);
  const lastFetched = store((s) => s.lastFetched);
  const ensureLoaded = store((s) => s.ensureLoaded);
  return { status, data, error, lastFetched, ensureLoaded };
}

// Unused helper kept off the export surface to avoid knip false positive.
// Re-export Getter so feature-store files can type their own actions.
export type StoreGetter<T> = Getter<T>;
