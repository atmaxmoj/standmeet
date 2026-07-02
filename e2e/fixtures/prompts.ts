// prompts.ts —— admin POST /api/admin/prompts 创建 owner prompt 的 helper。
//
// prompts 是集中管理的 persona/instruction 片段库；role.prompt_id (#103) 和
// access_code.prompt_id (#104) 都引它。测 per-entity prompt 时先建一份，再挂上去。

import type { APIRequestContext } from '@playwright/test';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

export interface CreatePromptInput {
  name: string;
  body: string;
  description?: string;
}

export interface PromptView {
  id: string;
  name: string;
  description: string;
  body: string;
}

export async function createPrompt(
  request: APIRequestContext,
  csrf: string,
  input: CreatePromptInput,
): Promise<PromptView> {
  const res = await request.post(`${BACKEND}/api/admin/prompts/`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      name: input.name,
      description: input.description ?? '',
      body: input.body,
    },
  });
  if (res.status() !== 201) {
    const text = await res.text();
    throw new Error(`create prompt failed: ${res.status()} ${text}`);
  }
  return await res.json() as PromptView;
}
