// instance.ts —— 拿 instance 元信息（v1 只有 default handle）。
// 服务端组件 SSR 用。

export type InstanceInfo = {
  handle: string;
};

export async function loadDefaultHandle(): Promise<string | null> {
  const backend = process.env['BACKEND_URL'] ?? 'http://backend:8000';
  const res = await fetch(`${backend}/api/v1/instance`, { cache: 'no-store' });
  const fallback = !res.ok;
  if (fallback) return null;
  const body = await res.json() as InstanceInfo;
  return body.handle !== '' ? body.handle : null;
}
