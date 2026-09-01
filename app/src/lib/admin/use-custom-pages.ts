// use-custom-pages —— /admin/custom-pages 状态。

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
  // bound_codes —— 哪些码开这一页（绑定的另一头）。nullish 是为了不让旧后端把整份列表打挂
  // （[[zod-unknown-is-not-optional]]：服务端少发一个字段，客户端整份 schema 静默失败）。
  bound_codes: z.array(z.string()).nullish(),
  allow_byoai: z.boolean().nullish(),
  // latest_build_id —— 面板靠它判"预览该刷新了"：agent 每次 build 产生一个新 id，
  // 那是唯一跟着 owner 指挥的这件事变的值。optional：后端 omitempty，
  // 而少一个字段不该把整份列表打挂（[[zod-unknown-is-not-optional]]）。
  latest_build_id: z.string().optional(),
  latest_build_status: z.string().optional(),
  // preview_url —— 面板那块 iframe 的 src，令牌已经签在里面。**不在前端拼**：
  // 令牌要服务端的钥匙，而前端自己拼的地址迟早跟服务端格式漂移，
  // 漂移之后的样子是预览一片空白而没有任何东西报错。
  preview_url: z.string().optional(),
  created_at: z.string(), updated_at: z.string(),
});
export type CustomPageSummary = z.infer<typeof CustomPageSummarySchema>;

// PreviewView —— 预览那一块要的三个值。
export interface PreviewView {
  src: string;
  buildID: string;
  status: string;
}

// previewView —— 三个 optional 字段各自的落点。落在 lib 而不是组件里：
// 呈现层的分支上限是 3，而三个 `??` 就已经到顶 —— 判断归这儿，组件只负责摆。
export function previewView(page: CustomPageSummary): PreviewView {
  return {
    src: page.preview_url ?? '',
    buildID: page.latest_build_id ?? '',
    status: page.latest_build_status ?? '',
  };
}

// usePinnedPreviewSrc —— 预览 iframe 的 src，钉在 buildID 上。
//
// preview_url 里的令牌是后端每次请求现签的（time.Now()），而这一页每 3 秒轮询一次 ——
// 于是同一次构建的 src 每 3 秒换一个新令牌。iframe 的 key 稳定但 src 一变，React 就更新
// src attribute → 整个 iframe 重新加载，owner 看到预览每 3 秒闪一下。这里只在 buildID
// 真的变了（落了一次新构建）时才换 src；令牌 churn 不动它。逻辑落在 lib 而不是组件里，
// 因为呈现层不许有 if（复杂度上限 3）。
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

// pollEveryMs —— owner 在**别处**（Claude 那边）下指令，这一页没有任何事件可以等，
// 所以只能问。3 秒：一次构建要几十秒，这个间隔足够让"它开始建了 / 建好了"及时出现，
// 又不至于把面板变成一个刷新器。
//
// 换成 SSE 更省，但那要后端多开一条推送 —— 而这条路上没有第二个消费者，
// 现在多建一条通道是为一个还不存在的需求付账。
const pollEveryMs = 3_000;

export function useCustomPages(): CustomPagesHook {
  const r = useResource(customPagesStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  // owner 打开这一页的时候，往往正在另一个窗口指挥 agent 改它。不轮询的话，
  // 他得自己刷新才看得到 —— 而"我得自己去刷"正是他抱怨的那件事。
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

// mutation 一律抛错，由调用方用 useAction 收尾（成功 toast / 失败 report）——
// 吞成 false 的话，「构建没跑起来」跟「构建跑了但失败」在屏幕上是同一件事。
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

// publishPage —— 建 → 写 → 构建 → 轮询 → 成功才上线，整条序列。
//
// 放在这一层而不是组件里：**构建是异步的**，而「在跑 / 成了 / 失败了」的判定是逻辑不是呈现。
// onTick 把每一次轮询的结果交回去，因为 owner 要看的正是「它还在跑」——
// 一个点下去没反应的按钮，跟一次失败的构建在屏幕上是同一件事。
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

// ensurePage —— 发布序列的第一步是「**这个页在不在**」，不是「建一个新页」。
//
// 改一版再发一次是这一屏最常做的事。上一版把 createPage 写死在第一步，于是第二次发
// 同一个 slug 撞 409，整条序列停在那里：源码没写上去、构建没跑、线上还是旧的 ——
// 面板上那个唯一的按钮对一个已经存在的页面**永远不工作**（F-P-2）。
//
// 只咽 409 这一种。别的失败照旧抛出去：一个 500 被当成「已经有了」的话，
// 接下来的写和构建都会打在一个不存在的页上，而 owner 只会看到一次莫名其妙的构建失败。
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

// promoteIfBuilt —— 只有构建成功才上线。**失败不许动线上**：
// 一次失败的构建把已经在服务的页面换掉，是最坏的一种"成功"。
async function promoteIfBuilt(slug: string, settled: BuildView): Promise<void> {
  if (settled.status !== 'built') return;
  await promote(slug, settled.build_id);
}

const POLL_MS = 1500;

// rollback / removePage —— **撤下**。owner 在面板上发得出去，就得在面板上撤得回来：
// 少了这两个，「admin 撤了访客就访问不到」这条规矩在面板上根本执行不了，
// owner 得开一个 Claude 会话去调 MCP 才能把自己刚发的东西拿下来（F-P-4）。
//
// rollback 只下线（构建还在，可以再上）；delete 是整页没了。两个动作分开摆，
// 因为它们的后果不一样。
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
  // 已经有数据就一直显列表 —— 3 秒轮询每次把 status 翻成 'loading',若那时用骨架替换列表,
  // 整列（含预览 iframe）每 3 秒卸载重挂 → 预览每 3 秒闪一下重载（pentest / owner 反馈
  // 2026-09-01）。骨架只属于**首次加载**（还没有任何数据）；后台刷新不该打断已经在看的东西。
  if (hook.rows.length > 0) return 'list';
  if (hook.status === 'idle' || hook.status === 'loading') return 'loading';
  if (hook.status === 'error') return 'error';
  return 'empty';
}
