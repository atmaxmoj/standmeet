// ReaderAboutCard —— reader 页尾那张「这是什么、能拿它做什么」的卡。
//
// **它说的话必须是这位访客做得到的事。** 卡片以前无条件写着「ask follow-ups below」,
// 而问答入口(FloatingChatDock)对没有会话的访客根本不渲染 —— 匿名读者读到的是一句
// 这一页自己证伪了的承诺(UX-86)。
//
// 所以「能不能接着问」只有一个判据 —— `useVisitorChatAvailable()`,浮窗和这张卡读同一个。
// 做不到的时候不是闭嘴,是给出他真走得到的那条路:进 `/gate` 输码
// ([[gate-handoff-no-inline-chat]])。
//
// 两个 genre 共用这一张卡:wiki 和 output 以前各抄了一份(措辞还不一样),而这条规矩
// 一旦分成两份,下次只会改到其中一份。

'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { useVisitorChatAvailable } from '@/lib/visitor/session-store';

export function ReaderAboutCard({ genre, handle }: { genre: 'wiki' | 'output'; handle: string }) {
  const t = useTranslations('reader');
  const canAsk = useVisitorChatAvailable();
  return (
    <div
      data-testid="reader-about"
      className="mt-12 px-4 py-3 border border-(--color-rule) rounded-[3px] bg-(--color-surface)/50"
    >
      <div className="smallcaps mb-1.5">{t(`${genre}.aboutHeading`)}</div>
      <p className="reading text-(--color-muted) text-[13.5px] m-0">
        {t(canAsk ? `${genre}.aboutBody` : `${genre}.aboutBodyGated`, { handle })}
        {!canAsk && <GateLink />}
      </p>
    </div>
  );
}

// GateLink —— 给出那条真走得到的路。卡片点名了一个动作就得把它递过来,
// 不然读者要自己找门([[button-that-cannot-be-wired]] 的反面)。
function GateLink() {
  const t = useTranslations('reader');
  return (
    <>
      {' '}
      <Link href="/gate" className="text-(--color-accent) underline underline-offset-2">
        {t('enterAccessCode')}
      </Link>
    </>
  );
}
