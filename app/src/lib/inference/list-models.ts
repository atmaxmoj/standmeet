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

const ENDPOINT = '/api/v1/inference/models';

export interface ListModelsInput {
  provider: string;
  endpoint: string;
  key: string;
}

interface ListModelsResponse {
  models: string[];
}

interface ErrorEnvelope {
  error?: { message?: string };
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
  const body = await res.json() as ListModelsResponse;
  return body.models;
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json() as ErrorEnvelope;
    return body.error?.message ?? `list models failed: ${res.status}`;
  } catch {
    return `list models failed: ${res.status}`;
  }
}
