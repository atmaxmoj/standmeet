// /report/[id] —— I.3: chat report 独立路由。AI 写完 HTML 报告，visitor
// 点 chat 里的 "open as page ↗" 进这条；浏览器全屏渲 iframe + 顶部 print
// button。
//
// Auth: visitor session token (Bearer) 由 client-side fetch 添加 (从
// localStorage 的 stored session 读)。session 跟 chat 同套 (use-gate
// 颁发 / 复用)。
//
// SSR 不出 HTML 内容 (auth header 不能放 query string；report 包含 AI
// 输出可能敏感)。SSR 只渲框架，client mount fetch 真 html 喂 iframe。

import { ReportArtifactPage } from '@/components/page/ReportArtifactPage';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return <ReportArtifactPage reportID={id} />;
}
