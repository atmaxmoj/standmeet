// issue-real-session.ts —— 浏览器侧调 POST /api/v1/sessions 拿 token +
// conversation_id + capability_state。给 /dev/agent-real 用。

import { z } from 'zod';

import type { CapabilityState } from '@standmeet/agent-core';
import { safeJson } from '@/lib/api/typed-json';

// browser 走相对路径 (跟 app/src/lib/api/public.ts baseURL() 浏览器分支)。
// Next rewrites 转给 backend；SSR 时此模块不会被求值 (页面 'use client')。
const APP_BACKEND = '';

export interface RealSessionInfo {
  sessionToken: string;
  conversationID: string;
  capabilities: readonly CapabilityState[];
}

const CapabilityStateSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  quota_remaining: z.number().optional(),
  policy_summary: z.string().optional(),
});

const IssueSessionWireSchema = z.object({
  session_token: z.string(),
  conversation_id: z.string(),
  capabilities: z.array(CapabilityStateSchema).default([]),
});

export async function issueSessionForRealRoute(
  code: string,
): Promise<RealSessionInfo> {
  const body = code === '' || code === 'public'
    ? { mode: 'public', visitor_name: 'real' }
    : { mode: 'code', code, visitor_name: 'real' };
  const res = await fetch(`${APP_BACKEND}/api/v1/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`issue session: ${res.status}`);
  }
  const j = await safeJson(res, IssueSessionWireSchema);
  return {
    sessionToken: j.session_token,
    conversationID: j.conversation_id,
    capabilities: j.capabilities,
  };
}
