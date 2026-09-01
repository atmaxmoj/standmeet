// use-embeds —— /admin/embeds 状态。一个 embed 把某张码作为 <standmeet-chat>
// widget 暴露到别人的网站上；来源白名单住在 embed 上（embed 规划 2026-09-01）。
//
// 跟 codes/custom-pages 同一套 zustand 样板：createResourceStore + 平级 action。

'use client';

import { useEffect, useState } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

const EmbedSchema = z.object({
  id: z.string(),
  code_id: z.string(),
  label: z.string(),
  // allowed_origins：后端 NOT NULL DEFAULT '[]',正常发数组。nullish 是防旧后端少发字段
  // 把整份列表打挂（[[zod-unknown-is-not-optional]]）。空数组 = 不限来源。
  allowed_origins: z.array(z.string()).nullish().transform((v) => v ?? []),
  // key_id —— 这个 embed 的 JWT kid（防盗凭据的标识）。widget 的 snippet 靠它 + 私钥签名。
  key_id: z.string().nullish().transform((v) => v ?? ''),
  created_at: z.string(),
});
export type EmbedView = z.infer<typeof EmbedSchema>;

// CreatedEmbedSchema —— 建 embed 的回执：比列表行多一个 **只此一次** 的私钥 PEM。
// 它进 widget 的 snippet（不是 code）；刷新列表就再也拿不到，所以 create 当场把它交出去。
const CreatedEmbedSchema = EmbedSchema.extend({ private_key: z.string() });
export type CreatedEmbed = z.infer<typeof CreatedEmbedSchema>;

export interface CreateEmbedInput {
  code_id: string;
  label: string;
  allowed_origins: string[];
}

export interface UpdateEmbedInput {
  label: string;
  allowed_origins: string[];
}

export interface EmbedsHook {
  status: ResourceStatus;
  embeds: readonly EmbedView[];
  error: string | null;
  refresh: () => Promise<void>;
  // createEmbed 回传**回执**：它带着只此一次的私钥，section 拿它当场亮出 snippet。
  createEmbed: (input: CreateEmbedInput) => Promise<CreatedEmbed>;
  updateEmbed: (id: string, input: UpdateEmbedInput) => Promise<void>;
  removeEmbed: (id: string) => Promise<void>;
}

export const embedsStore = createResourceStore<EmbedView[]>({
  name: 'embeds',
  fetcher: () => adminAPI.get('/embeds/', z.array(EmbedSchema)),
});

export function useEmbeds(): EmbedsHook {
  const r = useResource(embedsStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return {
    status: r.status,
    embeds: r.data ?? [],
    error: r.error,
    refresh: embedsStore.getState().refresh,
    createEmbed,
    updateEmbed,
    removeEmbed,
  };
}

// mutation 一律抛错，调用方用 useAction/report 收尾（成功 toast / 失败保持表单开着）——
// 吞成 false 的话，「没建成」跟「建了但白名单没生效」在屏幕上是同一件事。
async function createEmbed(input: CreateEmbedInput): Promise<CreatedEmbed> {
  const created = await adminAPI.post('/embeds/', input, CreatedEmbedSchema);
  embedsStore.getState().mutate((prev) => [created, ...(prev ?? [])]);
  return created;
}

async function updateEmbed(id: string, input: UpdateEmbedInput): Promise<void> {
  const updated = await adminAPI.patch(`/embeds/${id}`, input, EmbedSchema);
  embedsStore.getState().mutate((prev) =>
    (prev ?? []).map((e) => e.id === updated.id ? updated : e));
}

async function removeEmbed(id: string): Promise<void> {
  await adminAPI.deleteVoid(`/embeds/${id}`);
  embedsStore.getState().mutate((prev) => (prev ?? []).filter((e) => e.id !== id));
}

// EmbedFormHook —— create/edit modal 的本地表单状态。放在 lib 而不是组件里：呈现层不许有
// `if` / 分支上限 3，而"编辑就用现有值、否则用空值"这几个 `?? ''` 已经把复杂度顶满了
// （跟 use-code-form 同一个理由）。
export interface EmbedFormHook {
  editing: boolean;
  codeID: string;
  label: string;
  origins: string;
  setCodeID: (v: string) => void;
  setLabel: (v: string) => void;
  setOrigins: (v: string) => void;
}

export function useEmbedForm(existing: EmbedView | null): EmbedFormHook {
  const [codeID, setCodeID] = useState(existing?.code_id ?? '');
  const [label, setLabel] = useState(existing?.label ?? '');
  const [origins, setOrigins] = useState((existing?.allowed_origins ?? []).join('\n'));
  return {
    editing: existing !== null,
    codeID, label, origins,
    setCodeID, setLabel, setOrigins,
  };
}

// parseOrigins —— textarea 一行一个来源。去空白、丢空行；不做协议校验（后端按精确串比对，
// owner 贴什么算什么），只把"看不见的空行"清掉，免得白名单里混进一个永远命不中的空串。
export function parseOrigins(text: string): string[] {
  return text.split('\n').map((s) => s.trim()).filter((s) => s !== '');
}

// dispatchEmbedSave —— editing 决定走 update 还是 create。分支挪 lib，让 modal 复杂度 ≤ 3。
export async function dispatchEmbedSave(
  existing: EmbedView | null,
  form: EmbedFormHook,
  onCreate: (codeID: string, label: string, origins: string[]) => Promise<void>,
  onUpdate: (id: string, label: string, origins: string[]) => Promise<void>,
): Promise<void> {
  const origins = parseOrigins(form.origins);
  if (existing === null) {
    await onCreate(form.codeID, form.label, origins);
    return;
  }
  await onUpdate(existing.id, form.label, origins);
}

// embedModalText —— modal 头部/按钮文案，按 editing 一次算好。呈现层因此不出现 `editing ? … : …`。
export function embedModalText(
  t: (k: string) => string, editing: boolean,
): { kicker: string; title: string; save: string } {
  return editing
    ? { kicker: t('editKicker'), title: t('editTitle'), save: t('saveEdit') }
    : { kicker: t('createKicker'), title: t('createTitle'), save: t('save') };
}

// pemToKeyB64 —— PEM 私钥（多行、带 -----BEGIN----- 头尾）压成单行 base64 DER：正是 PEM 中间那段。
// widget 的 WebCrypto importKey('pkcs8', ...) 收的就是这段 base64（snippet 里当属性放不下多行）。
export function pemToKeyB64(pem: string): string {
  return pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
}

// widgetSnippet —— owner 复制走贴进别人网站的那两行。**防盗版：不含明文 code。**
//
// 地址运行时算（owner 的实例在自己的域名上）。带的是**每-embed 的凭据**（embed id + kid + 私钥），
// widget 现签 JWT、服务端反查出 code —— code 明文从不进这段公开 HTML。私钥只在创建时给一次，
// 所以这段完整 snippet 也只在创建时拼得出（[[embed-credential-never-carries-the-code]]）。
export function widgetSnippet(
  origin: string, embedID: string, keyID: string, privateKeyPem: string,
): string {
  return [
    `<script src="${origin}/embed.js"></script>`,
    `<standmeet-chat base-url="${origin}"`,
    `  embed="${embedID}" kid="${keyID}" key="${pemToKeyB64(privateKeyPem)}"></standmeet-chat>`,
  ].join('\n');
}
