// instance.ts —— 拿 instance 元信息（v1 单 owner instance：claimed + handle +
// 仅 unclaimed 时携带的 setup_token）。
//
// 根路由 / 的 server component 用 setup_token 做 server-side redirect 到
// /setup?t=<token>，让 operator 首次部署后打开域名 / 就自动进 claim 流程。
// claimed 之后 setup_token 永远不返回。

import { z } from 'zod';

import { safeJson } from '@/lib/api/typed-json';

const InstanceInfoSchema = z.object({
  claimed: z.boolean(),
  handle: z.string(),
  // name —— owner 全名(by-line 用,如 wiki 元信息「by Sijie Wang」)。
  name: z.string().optional().default(''),
  setup_token: z.string().optional(),
  captcha_site_key: z.string().optional(),
  // can_deliver_codes —— owner 有 connected 的 mail connector(能发码邮件)。
  // gate 据此决定是否展示「request access」整块。默认 false(发不出就不展示)。
  can_deliver_codes: z.boolean().optional().default(false),
});
export type InstanceInfo = z.infer<typeof InstanceInfoSchema>;

const FALLBACK: InstanceInfo = { claimed: false, handle: '', name: '', can_deliver_codes: false };

export async function fetchInstance(): Promise<InstanceInfo> {
  const backend = process.env['BACKEND_URL'] ?? 'http://backend:8000';
  const res = await fetch(`${backend}/api/v1/instance`, { cache: 'no-store' });
  if (!res.ok) return FALLBACK;
  return safeJson(res, InstanceInfoSchema);
}
