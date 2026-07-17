// VisitorPreviewModal —— owner 看 visitor 拿这个 code 落地时的样子 + 可
// 以"试一聊"。点 "test this code" 按真访客身份起 session（visitor_name
// = "(owner test)"），发一条 message，看 streamed reply。
//
// owner 之前只能开隐身浏览器假装访客 —— 现在卡里就能跑一遍。

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { ModalShell } from '@/components/admin/modals/ModalShell';
import { useCodeTest, type CodeTestHook } from '@/lib/admin/use-code-test';

import type { CodeView } from '@/lib/admin/use-codes';

type Props = { code: CodeView; onClose: () => void };

export function VisitorPreviewModal({ code, onClose }: Props) {
  return (
    <ModalShell
      onClose={onClose}
      kicker={`visitor preview · code ${code.code}`}
      title={code.label}
      maxWidth={680}
    >
      <div className="px-7 py-8 space-y-6 max-h-[75vh] overflow-y-auto">
        <Greeting label={code.label} />
        <SuggestedList items={code.ghosts ?? []} />
        <RoleNote roleID={code.assumed_role_id} code={code.code} />
        <SelfTest code={code} />
      </div>
    </ModalShell>
  );
}

const accentTag = (chunks: ReactNode) => <span className="text-(--color-accent)">{chunks}</span>;

function Greeting({ label }: { label: string }) {
  const t = useTranslations('adminShell.visitorPreview');
  return (
    <div>
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-3">
        {t('ownerAiReady')}
      </div>
      <p className="reading-tight text-(--color-ink) text-[17px]">
        {t.rich('welcome', { label, accent: accentTag })}
      </p>
    </div>
  );
}

function SuggestedList({ items }: { items: readonly string[] }) {
  return items.length === 0
    ? <EmptySuggested />
    : <SuggestedItems items={items} />;
}

function SuggestedItems({ items }: { items: readonly string[] }) {
  const t = useTranslations('adminShell.visitorPreview');
  return (
      <div>
        <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2">
          {t('suggestedQuestions')}
        </div>
        <ul className="space-y-1 font-serif italic text-(--color-muted) text-[15px]">
          {items.slice(0, 5).map((q, i) => <li key={i}>&ldquo;{q}&rdquo;</li>)}
        </ul>
      </div>
  );
}

function EmptySuggested() {
  const t = useTranslations('adminShell.visitorPreview');
  return (
    <div className="mono text-[11px] text-(--color-faint) border border-dashed border-(--color-rule) px-4 py-3 rounded-sm">
      {t('noSuggested')}
    </div>
  );
}

function RoleNote({ roleID, code }: { roleID: string; code: string }) {
  const t = useTranslations('adminShell.visitorPreview');
  return (
    <div className="pt-4 border-t border-(--color-rule)/70 mono text-[10px] tracking-[0.12em] text-(--color-faint) leading-[1.7]">
      <div>{t('assumesRole')} <span className="text-(--color-muted)">{roleID.slice(0, 8)}…</span></div>
      <div>{t('codeLine', { code })}</div>
    </div>
  );
}

function SelfTest({ code }: { code: CodeView }) {
  const t = useTranslations('adminShell.visitorPreview');
  const hook = useCodeTest();
  return (
    <div className="pt-4 border-t border-(--color-rule)/70 space-y-3">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">
        {t('testThisCode')}
      </div>
      <SelfTestBody code={code.code} hook={hook} />
    </div>
  );
}

function SelfTestBody({
  code, hook,
}: { code: string; hook: CodeTestHook }) {
  return hook.state.phase === 'idle' || hook.state.phase === 'opening'
    ? <StartRow code={code} hook={hook} />
    : <ChatRow hook={hook} />;
}

function StartRow({
  code, hook,
}: { code: string; hook: CodeTestHook }) {
  const busy = hook.state.phase === 'opening';
  return (
    <button
      type="button"
      onClick={() => void hook.start(code)}
      disabled={busy}
      data-testid="code-self-test-start"
      className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-3 py-2 hover:bg-(--color-accent) transition-colors disabled:opacity-40"
    >
      {busy ? 'opening…' : 'open test session ↗'}
    </button>
  );
}

function ChatRow({ hook }: { hook: CodeTestHook }) {
  const [text, setText] = useState('');
  return (
    <div className="space-y-3">
      <ChatInputRow text={text} setText={setText} hook={hook} />
      <ReplyArea hook={hook} />
    </div>
  );
}

function ChatInputRow({
  text, setText, hook,
}: { text: string; setText: (v: string) => void; hook: CodeTestHook }) {
  const busy = hook.state.phase === 'streaming';
  return (
    <div className="flex items-baseline gap-2 border-b border-(--color-rule)">
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="ask your AI a question…"
        spellCheck={false}
        data-testid="code-self-test-input"
        className="flex-1 min-w-0 bg-transparent py-2 reading-tight text-[15px]"
      />
      <SendBtn busy={busy} onClick={() => void hook.send(text)} />
    </div>
  );
}

function SendBtn({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      data-testid="code-self-test-send"
      className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-muted) hover:text-(--color-accent) disabled:opacity-40 shrink-0"
    >
      {busy ? 'streaming…' : 'send ↵'}
    </button>
  );
}

function ReplyArea({ hook }: { hook: CodeTestHook }) {
  return hook.state.error !== null
    ? <ReplyError msg={hook.state.error} />
    : <ReplyText reply={hook.state.reply} />;
}

function ReplyText({ reply }: { reply: string }) {
  return reply === '' ? null : (
    <div
      data-testid="code-self-test-reply"
      className="reading-tight text-(--color-ink) text-[14.5px] whitespace-pre-wrap border-l border-(--color-accent) pl-3 py-1"
    >
      {reply}
    </div>
  );
}

function ReplyError({ msg }: { msg: string }) {
  return (
    <p className="mono text-[10.5px] text-(--color-accent)">
      {msg}
    </p>
  );
}
