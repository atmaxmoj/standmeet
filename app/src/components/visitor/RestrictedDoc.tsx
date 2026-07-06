// RestrictedDoc —— 公开 landing(wiki/output)上非 indexed / 受限文档的客户端
// 兜底:持 code 的访客凭 session 走 corpus_read 把全文取回来渲染(role ACL 授了
// 就看得见 —— AI 就是凭这访问读出来引用的)。无 session / 无权才落锁屏。
//
// SSR 那层只认 published,拿不到访客 localStorage session,所以这一兜底必须
// 在客户端做。

'use client';

import Link from 'next/link';

import { ChatMarkdown } from '@/components/page/markdown';
import { CorpusContent } from '@/components/page/CorpusContent';
import { FloatingChatDock } from '@/components/visitor/FloatingChatDock';
import { SessionStrip } from '@/components/visitor/SessionStrip';
import type { VisitorDoc } from '@/lib/api/public';
import { useSessionScopedDoc } from '@/lib/visitor/use-session-doc';

export function RestrictedDoc({ genre, slug }: { genre: 'wiki' | 'output'; slug: string }) {
  const { loading, doc } = useSessionScopedDoc(slug);
  return (
    <>
      <SessionStrip />
      <main className="pb-24">
        {loading
          ? <Centered>opening…</Centered>
          : <Resolved genre={genre} slug={slug} doc={doc} />}
      </main>
      <FloatingChatDock />
    </>
  );
}

function Resolved({ genre, slug, doc }: {
  genre: 'wiki' | 'output'; slug: string; doc: VisitorDoc | null;
}) {
  return doc !== null
    ? <DocContent genre={genre} slug={slug} title={doc.title} body={doc.body} />
    : <Locked genre={genre} slug={slug} />;
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

function Locked({ genre, slug }: { genre: string; slug: string }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-24 text-center">
      <Home />
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-4">
        {genre} · {slug}
      </div>
      <h2 className="font-serif text-[28px] text-(--color-ink) font-normal mb-4">
        This {genre === 'output' ? 'output' : 'entry'} requires an access code
      </h2>
      <p className="reading text-(--color-muted) text-[16px] max-w-[36em] mx-auto mb-8">
        The owner has restricted this entry. Enter an access code on the gate to
        view the full content.
      </p>
      <Link
        href="/gate"
        className="mono text-[11px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-4 py-2.5 inline-block hover:bg-(--color-accent) transition-colors"
      >
        enter access code →
      </Link>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-24 text-center mono text-[11px] tracking-[0.16em] uppercase text-(--color-muted)">
      {children}
    </div>
  );
}

function Home() {
  return (
    <header className="mb-8">
      <Link href="/" className="mono text-[10.5px] tracking-[0.12em] text-(--color-muted) hover:text-(--color-accent)">
        ← home
      </Link>
    </header>
  );
}
