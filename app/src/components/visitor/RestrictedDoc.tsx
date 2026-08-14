// RestrictedDoc —— 公开 landing(wiki/output)上非 indexed / 受限文档的客户端
// 兜底:持 code 的访客凭 session 走 corpus_read 把全文取回来渲染(role ACL 授了
// 就看得见 —— AI 就是凭这访问读出来引用的)。无 session / 无权才落锁屏。
//
// SSR 那层只认 published,拿不到访客 localStorage session,所以这一兜底必须
// 在客户端做。

'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { ChatMarkdown } from '@/components/page/markdown';
import { CorpusContent } from '@/components/page/CorpusContent';
import { FloatingChatDock } from '@/components/visitor/FloatingChatDock';
import { SessionStrip } from '@/components/visitor/SessionStrip';
import type { VisitorDoc } from '@/lib/api/public';
import { useSessionScopedDoc } from '@/lib/visitor/use-session-doc';

export function RestrictedDoc({ genre, slug }: { genre: 'wiki' | 'output'; slug: string }) {
  const { loading, doc, hasSession } = useSessionScopedDoc(slug);
  const t = useTranslations('visitor.restrictedDoc');
  return (
    <>
      <SessionStrip />
      <main className="pb-24">
        {loading
          ? <Centered>{t('opening')}</Centered>
          : <Resolved genre={genre} slug={slug} doc={doc} hasSession={hasSession} />}
      </main>
      <FloatingChatDock />
    </>
  );
}

function Resolved({ genre, slug, doc, hasSession }: {
  genre: 'wiki' | 'output'; slug: string; doc: VisitorDoc | null; hasSession: boolean;
}) {
  return doc !== null
    ? <DocContent genre={genre} slug={slug} title={doc.title} body={doc.body} />
    : <Locked genre={genre} slug={slug} hasSession={hasSession} />;
}

function DocContent({ genre, slug, title, body }: {
  genre: string; slug: string; title: string; body: string;
}) {
  return (
    <article className="mx-auto max-w-2xl px-6 py-16" data-testid={`${genre}-landing`}>
      <Home />
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-4">
        {genre} · {slug}
      </div>
      <h1 className="font-serif text-[clamp(30px,4vw,46px)] text-(--color-ink) font-normal tracking-[-0.02em] leading-[1.08] mb-8">
        {title}
      </h1>
      <div className="reading text-base" data-testid={`${genre}-body`}>
        <CorpusContent>
          <ChatMarkdown source={body} />
        </CorpusContent>
      </div>
    </article>
  );
}

// Locked —— 这条读不到。**testid 挂在这一支上**:没有它,"访客看不到这条"只能靠
// "某个元素不存在"来断,而元素不存在在页面 404、组件改名、路由挂掉时同样成立 ——
// 一条在功能坏掉时也会绿的断言。要断的是"访客确实被拦在门外",那得有个正向的标记。
// Locked 的两句话不是同一句 —— 说哪一句由**访客手里有没有码**决定（F-R-6）。
//
// 没有码：去 gate 输一张，这是能走的下一步。
// 有码：让他再去输一次码，是让他重做一件已经做完的事 —— 而顶栏同一屏上就写着他的码。
// 后端对「越权」和「不存在」一律回 404（不承认存在，这是对的），所以这句话必须**把两种
// 情况都说进去**，而不是挑一种断言 —— 挑错的那一次就是一句关于世界的假话。
function Locked({ genre, slug, hasSession }: {
  genre: string; slug: string; hasSession: boolean;
}) {
  const t = useTranslations('visitor.restrictedDoc');
  return (
    <div className="mx-auto max-w-2xl px-6 py-24 text-center" data-testid={`${genre}-locked`}>
      <Home />
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-4">
        {genre} · {slug}
      </div>
      <h2 className="font-serif text-[28px] text-(--color-ink) font-normal mb-4">
        {lockedTitle(t, genre, hasSession)}
      </h2>
      <p className="reading text-(--color-muted) text-[16px] max-w-[36em] mx-auto mb-8">
        {hasSession ? t('outOfScopeBody') : t('lockedBody')}
      </p>
      <GateCTA show={!hasSession} />
    </div>
  );
}

// lockedTitle —— 组件里禁 if/复杂度，标题的三岔（有码 / 无码×output / 无码×entry）抽出来。
function lockedTitle(
  t: (k: string, v?: Record<string, string>) => string, genre: string, hasSession: boolean,
): string {
  return hasSession
    ? t('outOfScopeTitle')
    : t('lockedTitle', { kind: genre === 'output' ? t('kindOutput') : t('kindEntry') });
}

function GateCTA({ show }: { show: boolean }) {
  const t = useTranslations('visitor.restrictedDoc');
  return show ? (
    <Link
      href="/gate"
      className="mono text-[11px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-4 py-2.5 inline-block hover:bg-(--color-accent) transition-colors"
    >
      {t('enterCode')}
    </Link>
  ) : null;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-24 text-center mono text-[11px] tracking-[0.16em] uppercase text-(--color-muted)">
      {children}
    </div>
  );
}

function Home() {
  const t = useTranslations('visitor.restrictedDoc');
  return (
    <header className="mb-8">
      <Link href="/" className="mono text-[10.5px] tracking-[0.12em] text-(--color-muted) hover:text-(--color-accent)">
        {t('home')}
      </Link>
    </header>
  );
}
