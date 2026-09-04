// prompts.ts —— helper for creating an owner prompt via admin POST /api/admin/prompts.
//
// prompts is a centrally managed library of persona/instruction fragments; both
// role.prompt_id (#103) and access_code.prompt_id (#104) reference it. To test a
// per-entity prompt, create one first, then attach it.

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
