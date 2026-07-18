// page.tsx —— 根公开页：SSR fetch `/api/v1/page`（sole owner，v1 单 owner
// instance）。把 hero / insights / projects / where / contact 五段渲染成
// 长滚屏，底部 sticky ChatDock 让访客可发问。
//
// pre-claim 时（instance 还没人 claim）/api/v1/instance 返 setup_token，
// 这里直接 server-side redirect 到 /setup?t=<token>，让首次部署的 operator
// 不用复制 stdout banner —— 打开域名 / 就自动到 setup 表单。

import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

import { fetchInstance } from '@/lib/api/instance';
import { fetchPublicPage } from '@/lib/api/public';

import { PageShell } from '@/app/page-shell';

// generateMetadata —— og:description / meta description 读**真** hero_prose（rot-C3）。
// 曾经根页没有 generateMetadata，于是继承 layout.tsx 里一句写死的 'A personal page that argues
// back.'，owner 改什么都不变；而 SEO UI 还叫 owner 去改一个根本不存在的 "page tagline"。现在
// 分享预览跟着 owner 的 hero prose 走。unclaimed / 取不到 → 退回中性默认（不崩）。
export async function generateMetadata(): Promise<Metadata> {
  try {
    const { owner, content } = await fetchPublicPage();
    const description = content.hero_prose.slice(0, 160);
    return {
      title: owner.full_name,
      description,
      openGraph: { title: owner.full_name, description, type: 'profile' },
    };
  } catch {
    return { title: 'StandMeet' };
  }
}

export default async function Root() {
  const instance = await fetchInstance();
  // unclaimed → server redirect to /setup?t=TOKEN (token from /api/v1/instance).
  // redirect() throws so subsequent fetchPublicPage / render never runs.
  instance.claimed || redirect(`/setup?t=${instance.setup_token ?? ''}`);
  const data = await fetchPublicPage();
  return <PageShell owner={data.owner} content={data.content} />;
}
