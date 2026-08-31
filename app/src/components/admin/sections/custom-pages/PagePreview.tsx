// PagePreview —— 这一页现在长什么样。
//
// **为什么这一块要存在**：这个面板以前只是一张表 —— slug、绑了哪些码、有没有 live。
// 一个字都不说这一页长什么样。而真正在写这些页的是 Claude（面板 intro 自己写着
// "creates / builds / promotes via MCP"），于是 owner 处在最糟的位置上：他在下指令，
// 而反馈只有一行 "has_live: true"。owner 的原话：
// "让我有 panel 能看效果，然后我在指挥 agent 改的时候实时能让我看到就好。"
//
// 看的是**最近一次构建成功的**那一版，不是 live —— agent 刚建好、还没 promote 的那版
// 才是他要看的（看完才决定上不上线）。后端那条路由：`/api/admin/custom-pages/{slug}/preview`。
//
// **刷新靠 key，不靠 reload()**：把 build id 编进 key，新构建落地时 React 把 iframe
// 整个换掉。手动调 contentWindow.location.reload() 要拿到 iframe 的 DOM 句柄，
// 而那在跨源 / 未加载完时会静默失败 —— 换 key 是"重建一个新元素"，没有失败的分支。

'use client';

import { useTranslations } from 'next-intl';

import { previewView, type CustomPageSummary } from '@/lib/admin/use-custom-pages';

export function PagePreview({ page }: { page: CustomPageSummary }) {
  const t = useTranslations('adminPages.customPages');
  // 地址由**后端**给（令牌签在里面）。前端只负责什么时候换一个新的。
  const view = previewView(page);
  return (
    <div className="border-t border-(--color-rule)/60">
      <div className="flex items-baseline justify-between px-4 py-2">
        <span className="mono text-[9.5px] tracking-[0.14em] uppercase text-(--color-faint)">
          {t('previewLabel')}
        </span>
        <BuildState status={view.status} />
      </div>
      <PreviewFrame slug={page.slug} buildID={view.buildID} src={view.src} />
    </div>
  );
}

// BuildState —— agent 正在建的时候，owner 要看得见"它在动"。
// 没有这一行，一次几十秒的构建期间屏幕完全静止，跟"我的指令没送到"分不开。
function BuildState({ status }: { status: string }) {
  const t = useTranslations('adminPages.customPages');
  return (
    <span
      data-testid="custom-page-build-state"
      className="mono text-[9.5px] tracking-[0.14em] uppercase text-(--color-muted)"
    >
      {status === '' ? t('buildNone') : status}
    </span>
  );
}

function PreviewFrame(
  { slug, buildID, src }: { slug: string; buildID: string; src: string },
) {
  const t = useTranslations('adminPages.customPages');
  return src === '' ? (
    <div
      data-testid={`custom-page-preview-empty-${slug}`}
      className="sm-empty mono text-[11px] text-(--color-faint) px-4 pb-4"
    >
      {t('previewNoBuild')}
    </div>
  ) : (
    <iframe
      // key 里带 build id：新构建落地 → React 换一个新 iframe，
      // 而不是让旧的自己去 reload。
      key={buildID}
      data-testid={`custom-page-preview-${slug}`}
      src={src}
      title={slug}
      // 沙箱：这是 owner 自己写的代码，但它跑在 admin 的来源上 ——
      // 不给 allow-same-origin，页面就碰不到 owner 的 session
      // （跟 widget-descriptor.ts 的 resolveDefaults 同一条理由）。
      sandbox="allow-scripts"
      className="w-full h-[420px] border-0 bg-(--color-paper)"
    />
  );
}
