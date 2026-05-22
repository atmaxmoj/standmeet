// instance.ts —— 拿 instance 元信息（v1 单 owner instance：claimed + handle +
// 仅 unclaimed 时携带的 setup_token）。
//
// 根路由 / 的 server component 用 setup_token 做 server-side redirect 到
// /setup?t=<token>，让 operator 首次部署后打开域名 / 就自动进 claim 流程。
// claimed 之后 setup_token 永远不返回。

export type InstanceInfo = {
  claimed: boolean;
  handle: string;
  setup_token?: string;
};

const FALLBACK: InstanceInfo = { claimed: false, handle: '' };

export async function fetchInstance(): Promise<InstanceInfo> {
  const backend = process.env['BACKEND_URL'] ?? 'http://backend:8000';
  const res = await fetch(`${backend}/api/v1/instance`, { cache: 'no-store' });
  if (!res.ok) return FALLBACK;
  return (await res.json()) as InstanceInfo;
}
