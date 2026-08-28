// ReaderChatRail —— 阅读器右侧那一列：**问这篇文章**。
//
// 为什么它必须常驻，而不是右下角那个浮动圆钮：
//
// 浮动钮只在**已经有会话**时出现（`useVisitorChatAvailable()` 就是 `session !== null`）。
// 于是一个没输过码、也没填过自己 key 的读者，在整篇 wiki 上看不到任何"可以问"的痕迹 ——
// 唯一提到这件事的地方是正文最底下那张卡片，得滑到底才看得见。
// 产品的整个论点是「语料是给人问的」，而这个入口在需要它的那一刻是隐形的。
//
// 所以右栏两种状态都渲：
//   · 有会话 → 就是聊天本身
//   · 没会话 → **就地**填自己的 key（BYOAI）就能开始问；用的是 `/gate` 上那份表单，
//     不另写一份（同一件事两份实现，改一处就漏另一处）
//
// 位置跟左边那棵树对称：左边是"这个语料库里有什么"，右边是"就这一篇问点什么"，
// 正文在中间不动。窄屏两边都不渲染 —— 挤进来的代价是正文没法读，那时右下角那个
// 浮动钮仍然在（它本来就是为窄屏做的形态）。

'use client';

import { useTranslations } from 'next-intl';

import { BYOAIPanel } from '@/components/gate/BYOAIPanel';
import { useGate } from '@/lib/gate/use-gate';
import { useVisitorChatAvailable } from '@/lib/visitor/session-store';

import styles from '@/components/visitor/ReaderChatRail.module.css';

export function ReaderChatRail({ children }: { children: React.ReactNode }) {
  const canAsk = useVisitorChatAvailable();
  return (
    <aside className={styles['rail']} data-testid="reader-chat-rail">
      {canAsk ? children : <ByoaiInvite />}
    </aside>
  );
}

// ByoaiInvite —— 没会话时右栏里的东西：一句话说清楚这里能做什么，然后**就在这儿**填 key。
//
// 不是一个跳去 /gate 的链接：读者此刻在读一篇具体的文章，把他弹走等于让他放弃上下文，
// 而他回来时那个念头已经没了。
function ByoaiInvite() {
  const t = useTranslations('visitor.readerChat');
  const hook = useGate();
  return (
    <div className={styles['invite']} data-testid="reader-chat-byoai">
      <div className={styles['kicker']}>{t('kicker')}</div>
      <h2 className={styles['heading']}>{t('heading')}</h2>
      <p className={styles['lede']}>{t('lede')}</p>
      <BYOAIPanel hook={hook} />
    </div>
  );
}
