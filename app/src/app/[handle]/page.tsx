// [handle]/page.tsx —— 公开 owner 页：SSR fetch `/api/v1/page/:handle`，
// 把 hero / insights / projects / where / contact 五段渲染成长滚屏，底部
// sticky ChatDock 让访客可发问。
//
// owner 不存在时 fetch throw，Next 默认 fallback 渲染 not-found。

import { fetchPublicPage } from '@/lib/api/public';

import { PageShell } from '@/app/[handle]/page-shell';

type Params = { handle: string };

export default async function HandlePage({ params }: { params: Promise<Params> }) {
  const { handle } = await params;
  const data = await fetchPublicPage(handle);
  return <PageShell owner={data.owner} content={data.content} />;
}
