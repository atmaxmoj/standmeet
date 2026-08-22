// list-models.ts —— POST /api/v1/inference/models 客户端封装。
//
// "Load models" button 调用入口：UI 选 provider + 填 endpoint + key 之后
// 点 button，server 端 proxy 上游 OpenAI-compat /v1/models 拉真实可用列表，
// UI 把 input 换成 dropdown。**无 auth**：调用方必须知道 (endpoint, key)
// 才能调，server 只是 proxy，不持有任何风险态。
//
// 错误处理：HTTP 4xx/5xx → throw Error with server's message。典型场景：
//   - Anthropic 没暴露 /v1/models → "list models: provider does not expose
//     a model list; type model id manually"
//   - 上游 401/403 → "list models: upstream 401: ..."
// 调用方拿 error.message 直接 toast。

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { safeJson } from '@/lib/api/typed-json';

const ENDPOINT = '/api/v1/inference/models';

export interface ListModelsInput {
  provider: string;
  endpoint: string;
  key: string;
}

const ListModelsResponseSchema = z.object({ models: z.array(z.string()) });
const ErrorEnvelopeSchema = z.object({ error: z.object({ message: z.string().optional() }).optional() });

// listOwnerModels —— owner 那一面：**不发 key**。
//
// 他的 key 存在服务端、页面永远读不回来，所以以前这颗按钮发出去的是一个空 key，后端
// `key required` 400，屏幕上什么都没有 —— 保存过一次之后就再也点不动了（F-R-11）。
// 这条走 owner 自己那条带 auth 的路，服务端拿库里存的那把去问上游。
export async function listOwnerModels(): Promise<string[]> {
  const body = await adminAPI.post('/providers/models', {}, ListModelsResponseSchema);
  return body.models;
}

export async function listModels(input: ListModelsInput): Promise<string[]> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
  const body = await safeJson(res, ListModelsResponseSchema);
  return body.models;
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body = await safeJson(res, ErrorEnvelopeSchema);
    return body.error?.message ?? `list models failed: ${res.status}`;
  } catch {
    return `list models failed: ${res.status}`;
  }
}
