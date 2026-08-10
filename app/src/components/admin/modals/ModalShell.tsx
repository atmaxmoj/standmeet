// ModalShell —— overlay + close 行为通用部分。
//
// **渲染到 body（portal），不留在调用它的那棵子树里。**
// `position: fixed` 的定位基准不是"视口"这么简单：任何一个带 transform / filter / backdrop-filter
// / contain 的祖先都会把基准换成它自己 —— 而这件事在代码里没有任何一处写着。于是「这个遮罩
// 到底盖住了什么」只能靠试，而 owner 定的判据是不许靠试（要么看日志，要么架构清晰到一眼看出）。
// portal 到 body 之后，祖先链只有 <body>，基准永远是视口 —— 这个问题**不再需要问**。
// 层级同理已经收进 --z-* 量表；两件事合起来，模态压住了谁是读得出来的事实。

'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { cssVars } from '@/lib/ui/css-vars';

type Props = {
  onClose: () => void;
  kicker?: string;
  title: string;
  maxWidth?: number;
  children: ReactNode;
};

export function ModalShell(props: Props) {
  // mounted —— SSR 时没有 document；挂载后才 portal。第一帧不渲染模态，而模态本来就是
  // 交互之后才出现的东西，所以这不影响首屏。
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? createPortal(<ModalBody {...props} />, document.body) : null;
}

function ModalBody({ onClose, kicker, title, maxWidth = 540, children }: Props) {
  const stop = useCallback((e: React.MouseEvent) => e.stopPropagation(), []);
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 sm-z-modal flex items-center justify-center bg-[var(--sm-scrim)] fadein p-4"
    >
      {/* 宽度走 `style` 而不是 `[--max-w:${'${maxWidth}'}px]` 那种拼出来的类名。
          Tailwind 在**构建期扫源码**,拼接的类它看不见 —— 那串进了 HTML,规则一条都没生成,
          于是 `.sm-max-w` 一直退到兜底的 `100%`:**每个模态都是满宽,maxWidth 从未生效过**。
          跟遮罩那次的简写形式是同一个失败形状,而且同样不报错(见 [[names-that-lie]])。
          动态值必须走 style —— 那是真的内联 CSS,不经过任何扫描。 */}
      <div
        onClick={stop}
        // eslint-disable-next-line no-restricted-syntax -- maxWidth 是入参，只有 style 能承载运行时值；类名形式会一条 CSS 都不生成
        style={cssVars({ '--max-w': `${maxWidth}px` })}
        className="flex flex-col w-full max-h-[85vh] overflow-hidden bg-(--color-paper) border border-(--color-rule) rounded-sm rise crosshair sm-max-w"
      >
        <span className="ch-tl" /><span className="ch-br" />
        <ModalHeader kicker={kicker} title={title} onClose={onClose} />
        {/* 框固定,只这块滚 —— header/close 永远钉在顶上 */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {children}
        </div>
      </div>
    </div>
  );
}

function ModalHeader({
  kicker, title, onClose,
}: { kicker?: string; title: string; onClose: () => void }) {
  const t = useTranslations('adminShell.modal');
  return (
    <div className="shrink-0 flex items-baseline justify-between px-7 py-5 border-b border-(--color-rule)">
      <ModalTitle kicker={kicker} title={title} />
      <button
        type="button"
        onClick={onClose}
        className="mono text-[11px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink)"
      >
        {t('close')}
      </button>
    </div>
  );
}

function ModalTitle({ kicker, title }: { kicker?: string; title: string }) {
  return (
    <div>
      {kicker ? <Kicker text={kicker} /> : null}
      <div className="font-serif text-(--color-ink) text-[22px]">{title}</div>
    </div>
  );
}

function Kicker({ text }: { text: string }) {
  return (
    <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted) mb-1">
      {text}
    </div>
  );
}
