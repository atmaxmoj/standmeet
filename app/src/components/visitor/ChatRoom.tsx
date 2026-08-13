// ChatRoom —— coded / BYOAI visitor 的 focused chat layout。design 源
// app.js ChatRoom。slim header + ChatWelcome + transcript +
// sticky ChatComposer。

'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';

import { composerPlaceholder, pickGhost } from '@/lib/visitor/ghost-text';
import { useCapabilityStore } from '@/lib/visitor/capability-store';
import { useDockButtonsStore } from '@/lib/visitor/dock-buttons-store';
import { dispatchComposerKey, useAutoGrowTextarea } from '@/lib/visitor/composer-keys';
import { composeMessage, useComposerAttachments } from '@/lib/visitor/composer-attachments';
import { AttachmentChips } from '@/components/visitor/ComposerAttachments';
import { GhostText } from '@/components/visitor/GhostText';

import Link from 'next/link';

import { SessionStrip } from '@/components/visitor/SessionStrip';
import { VisitorNamePicker } from '@/components/visitor/VisitorNamePicker';
import { ChatTranscript, ChatProgress } from '@/components/visitor/ChatTranscript';
import { useChatRoomDerived, useChatRoomInput } from '@/lib/visitor/chat-room-state';
import { useConsumeQuestionFromURL } from '@/lib/page/consume-question-url';
import type { SessionMode } from '@/lib/page/use-chat';
import type { PublicOwnerView } from '@/lib/api/public';

type Props = { owner: PublicOwnerView; mode: SessionMode };

export function ChatRoom({ owner, mode }: Props) {
  const derived = useChatRoomDerived();
  const ci = useChatRoomInput(mode);
  // 从首页带着问题(/gate?q= → 过闸 → /?q=)进来的:mount 时把那个问题接着问掉(不丢)。
  useConsumeQuestionFromURL(ci.onAsk);
  // Normal-chat behaviour: keep the transcript pinned to the bottom as messages
  // arrive + stream (dialogs is a fresh array each stream tick → fires here),
  // so the newest answer is always in view.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    el && el.scrollTo(0, el.scrollHeight);
  }, [ci.chat.dialogs]);
  return (
    <div className="h-screen flex flex-col overflow-hidden" data-testid="chatroom">
      <SessionStrip
        leading={<BrandMark handle={owner.handle} />}
        trailing={<FullPageLink />}
      />
      <VisitorNamePicker />
      <main className="flex-1 flex flex-col min-h-0">
        <div className="max-w-[760px] w-full mx-auto px-6 lg:px-0 flex-1 flex flex-col min-h-0">
          {/* scroll area: welcome + transcript scroll here; composer stays docked */}
          {/* sm-scroll-read：右侧留出滚动条的位置。覆盖式滚动条显示期间会压掉每行
              最后一个字符（"does a" / "should"），而这一栏是长段衬线散文（UX-71）。 */}
          <div ref={scrollRef} className="sm-scroll-read flex-1 min-h-0">
            <ChatWelcome owner={owner} d={derived} hasDialogs={ci.chat.dialogs.length > 0} />
            <ChatTranscript
              dialogs={ci.chat.dialogs} onAsk={ci.onAsk}
              conversationID={ci.chat.conversationID}
            />
          </div>
          {/* docked bottom: progress + composer + footnote stay pinned to the viewport */}
          <div className="shrink-0 bg-(--color-paper)">
            <ChatProgress dialogs={ci.chat.dialogs} />
            <ChatComposer
              input={ci.input} setInput={ci.setInput} onSubmit={ci.onAsk}
              pending={ci.chat.pending} exhausted={ci.exhausted}
              showStarters={ci.chat.dialogs.length === 0} mode={derived.mode}
              ghost={ci.ghost} onAcceptGhost={ci.onAcceptGhost}
            />
            <ChatFootnote handle={owner.handle} mode={derived.mode} />
          </div>
        </div>
      </main>
    </div>
  );
}

// ── header ──────────────────────────────────────────────────
//
// 这一屏原来在会话横条**上面**再摞一条整宽页眉。两条都是整宽、都是等宽小字、都各画一个
// live dot —— 一条讲这次会话，一条讲这个站点，加起来 68px 的页眉挡在正文前面（UX-53）。
// 站点身份和 `FULL PAGE →` 现在挂进会话横条自己的两个槽，一条横条讲完两件事，
// 而 live dot 只剩一个（会话横条那个）。

function BrandMark({ handle }: { handle: string }) {
  const t = useTranslations('visitor.chatRoom');
  return (
    <span className="inline-flex items-baseline gap-2 mr-1">
      <span className="text-(--color-ink)">{t('brand')}</span>
      <span className="text-(--color-faint)">/</span>
      <span className="text-(--color-muted)">{handle}</span>
      <span className="text-(--color-faint)">·</span>
    </span>
  );
}

function FullPageLink() {
  const t = useTranslations('visitor.chatRoom');
  return (
    <Link href="/" className="sm-session-strip-link">
      {t('fullPage')}
    </Link>
  );
}

// ── welcome ────────────────────────────────────────────────

// 空会话不画介绍语下面那条线。有 transcript 时它是「介绍语到此为止」的分隔；没有时，
// 它跟输入区顶部那条线一起，把中间那段留白框成一个**有边框的空盒子** —— 读起来不像
// 「这里还没有内容」，像有东西没加载出来（UX-72）。
function ChatWelcome({ owner, d, hasDialogs }: {
  owner: PublicOwnerView; d: ReturnType<typeof useChatRoomDerived>; hasDialogs: boolean;
}) {
  const t = useTranslations('visitor.chatRoom');
  return (
    <article
      className={`pt-10 pb-10 ${hasDialogs ? 'border-b border-(--color-rule)' : ''}`}
      data-testid="chat-welcome"
    >
      <div className="mono text-[10.5px] tracking-[0.18em] uppercase text-(--color-accent) mb-3">
        {t('ready', { handle: owner.handle })}
      </div>
      <div className="reading text-(--color-ink) text-[17px] max-w-[54ch]">
        {d.mode === 'coded'
          ? <CodedWelcome handle={owner.handle} visitor={d.visitor} codeLabel={d.codeLabel} />
          : <ByoaiWelcome handle={owner.handle} provider={d.provider} />}
      </div>
    </article>
  );
}

const accentTag = (c: React.ReactNode) => <span className="text-(--color-accent)">{c}</span>;

function CodedWelcome({ handle, visitor, codeLabel }: { handle: string; visitor: string | null; codeLabel: string }) {
  const t = useTranslations('visitor.chatRoom');
  const greeting = visitor ? `Hi, ${visitor.split(' ')[0]}` : 'Hi';
  return (
    <>
      <p>{t.rich('codedWelcome', { greeting, handle, codeLabel, accent: accentTag })}</p>
      <p className="mt-4">{t('codedRedaction', { handle })}</p>
      <p className="mt-4">{t('codedStarters')}</p>
    </>
  );
}

function ByoaiWelcome({ handle, provider }: { handle: string; provider: string }) {
  const t = useTranslations('visitor.chatRoom');
  return (
    <>
      <p>{t.rich('byoaiWelcome', { handle, provider, accent: accentTag })}</p>
      <p className="mt-4">{t('byoaiScope')}</p>
    </>
  );
}


// ── composer ───────────────────────────────────────────────

const CODED_STARTERS = ['Walk me through your background.', 'What did you actually own at your last role?', 'What’s a take you hold that most peers disagree with?'];
const BYOAI_STARTERS = ['What are you working on right now?', 'How do you think about AI replacing engineers?'];

// ComposerProps —— ChatRoom 那条 sticky 输入框的全部 prop。ghost 三件套
// 是 H.13.d 加的；code-accessor visitor 才会收到非 null ghost。
type ComposerProps = {
  input: string; setInput: (v: string) => void; onSubmit: (q: string) => void;
  pending: boolean; exhausted: boolean;
  ghost: string | null; onAcceptGhost: (g: string) => void;
};

// tryVisible —— 有 ghost 时不摆 TRY。两者都在说「你可以问什么」，但含义不同：TRY 是码带的
// 固定 starters（冷启动的脚手架），ghost 是**刚才那一轮**生成的。上下相邻、两种排版语言，
// 访客读到的只是"这里有一堆建议"，分不出哪条跟刚才那轮有关（UX-35）。ghost 一出现，脚手架就撤。
function tryVisible(showStarters: boolean, ghost: string | null): boolean {
  return showStarters && (ghost === null || ghost === '');
}

function ChatComposer({ showStarters, mode, ...rest }: ComposerProps & { showStarters: boolean; mode: string }) {
  const starters = mode === 'byoai' ? BYOAI_STARTERS : CODED_STARTERS;
  const showTry = tryVisible(showStarters, rest.ghost);
  return (
    <div className="sticky bottom-0 sm-z-dock bg-(--color-paper)/95 backdrop-blur border-t border-(--color-rule) pt-4 pb-5">
      <DockButtons onPick={rest.onSubmit} pending={rest.pending} />
      {showTry && <StarterChips starters={starters} onPick={rest.onSubmit} pending={rest.pending} />}
      <ComposerForm {...rest} />
    </div>
  );
}

function ComposerForm(p: ComposerProps) {
  const blocked = p.pending || p.exhausted;
  const ghost = pickGhost({ value: p.input, blocked, ghost: p.ghost });
  // ghost **不进 placeholder**(F-A-25):placeholder 不换行,长一点的引导就在半句话处被裁掉,
  // 访客读不完也就不知道自己被引向哪儿。它由 GhostText 渲成会换行的覆盖层,而 composerPlaceholder
  // 在 ghost 在场时把 placeholder 让成空 —— 两层都画会叠字。
  const placeholder = composerPlaceholder({
    locked: p.exhausted, lockedText: 'session full', ghost, fallback: 'ask…',
  });
  const att = useComposerAttachments();
  const taRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrowTextarea(taRef, p.input);
  // sendComposed —— 投出去 + 清空附件(input 的清空在 onAsk 里)。
  const sendComposed = (msg: string): void => {
    p.onSubmit(msg);
    att.clear();
  };
  // submit —— 把输入框文字 + 已挂附件原文拼成最终消息再投。Enter 与点 button
  // 走同一条;ready 守卫用 && 而非 if(presentation 禁 if)。
  const submit = (): void => {
    const msg = composeMessage(p.input, att.attachments);
    isComposerReady(msg, p.pending, p.exhausted) && sendComposed(msg);
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} data-testid="chat-input">
      <AttachmentChips attachments={att.attachments} onRemove={att.remove} />
      <div className="flex items-end gap-4 py-3 border-t border-b border-(--color-ink) relative">
        <span className="text-(--color-accent) font-serif shrink-0 text-[26px] leading-none pb-1">›</span>
        {/* ghost 在场时由 GhostText 撑出这一格的高度(它会换行),textarea 浮在它上面;
            访客一打字 pickGhost 就返回 null,textarea 回到常流,由 useAutoGrowTextarea 管高。 */}
        <div className="relative flex-1 min-w-0">
          <textarea
            ref={taRef} rows={1} value={p.input}
            onChange={(e) => p.setInput(e.target.value)}
            onPaste={(e) => { att.onPaste(e); }}
            onKeyDown={(e) => dispatchComposerKey(e, {
              ghost, onSubmit: submit, onAccept: p.onAcceptGhost,
            })}
            placeholder={placeholder}
            disabled={blocked}
            className={ghostClass(ghost)}
            autoComplete="off" spellCheck={false} autoFocus
            data-testid="chat-input-field"
            data-ghost={ghost ?? ''}
          />
          <GhostText text={ghost} />
        </div>
        <ComposerAction pending={p.pending} exhausted={p.exhausted} />
      </div>
    </form>
  );
}

// ghostClass —— ghost 在场时 textarea 绝对定位盖在 GhostText 上(高度由 ghost 决定),
// 否则回到常流自己撑高。排版两条路必须完全一致,不然接受 ghost 的一瞬文字会跳。
const composerTypography = 'bg-transparent text-(--color-ink) placeholder:text-(--color-faint) '
  + 'font-serif text-[22px] leading-[1.4] font-[380] disabled:opacity-60 resize-none';

function ghostClass(ghost: string | null): string {
  return ghost === null
    ? `w-full ${composerTypography}`
    : `absolute inset-0 w-full h-full ${composerTypography}`;
}

function isComposerReady(msg: string, pending: boolean, exhausted: boolean): boolean {
  return msg.trim() !== '' && !pending && !exhausted;
}

function ComposerAction({ pending, exhausted }: { pending: boolean; exhausted: boolean }) {
  const t = useTranslations('visitor.chatRoom');
  return exhausted ? (
    <span className="mono text-[10.5px] tracking-[0.16em] uppercase text-(--color-accent) shrink-0 pt-1">{t('sessionFull')}</span>
  ) : (
    <button type="submit" disabled={pending}
      className="mono text-[11.5px] tracking-[0.18em] uppercase text-(--color-muted) hover:text-(--color-accent) disabled:text-(--color-faint) transition-colors shrink-0 pt-1">
      {t.rich('ask', { big: (c) => <span className="text-[14px]">{c}</span> })}
    </button>
  );
}

function StarterChips({ starters, onPick, pending }: {
  starters: readonly string[]; onPick: (q: string) => void; pending: boolean;
}) {
  const t = useTranslations('visitor.common');
  return (
    <div className="flex flex-wrap gap-x-1 gap-y-2 mb-3 overflow-x-auto" data-testid="starter-chips">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-faint) mr-3 shrink-0 pt-0.5">{t('try')}</span>
      {starters.map((q, i) => (
        <StarterChip key={q} q={q} last={i === starters.length - 1} onPick={onPick} pending={pending} />
      ))}
    </div>
  );
}

function StarterChip({ q, last, onPick, pending }: { q: string; last: boolean; onPick: (q: string) => void; pending: boolean }) {
  return (
    <span>
      <button type="button" onClick={() => onPick(q)} disabled={pending}
        className="font-serif italic text-(--color-muted) hover:text-(--color-accent) transition-colors text-left disabled:opacity-50 shrink-0 text-[14.5px] leading-[1.4]">
        &ldquo;{q}&rdquo;
      </button>
      {!last && <span className="text-(--color-faint) not-italic mx-2">/</span>}
    </span>
  );
}

// ── dock buttons (#109/#110) ─────────────────────────────────
// owner 在 role 上配的 ≤2 个快捷按钮。点击 = 把 owner 写的「触发词」当访客消息发出（跟打字、
// 跟 owner 在自己 UI 里呼唤同一条路，按钮只是快捷方式）。能力被 ACL 关掉 → 置灰。

function DockButtons({ onPick, pending }: { onPick: (q: string) => void; pending: boolean }) {
  const buttons = useDockButtonsStore((s) => s.buttons);
  const caps = useCapabilityStore((s) => s.states);
  return buttons.length === 0 ? null : (
    <div className="flex flex-wrap gap-2 mb-3" data-testid="dock-buttons">
      {buttons.map((b) => (
        <DockButton
          key={b.capability_id}
          capabilityId={b.capability_id}
          title={b.title}
          trigger={b.trigger}
          state={capState(caps, b.capability_id)}
          onPick={onPick}
          pending={pending}
        />
      ))}
    </div>
  );
}

type DockCapState = { enabled: boolean; reason: string };

function DockButton({
  capabilityId, title, trigger, state, onPick, pending,
}: {
  capabilityId: string;
  title: string;
  trigger: string;
  state: DockCapState;
  onPick: (q: string) => void;
  pending: boolean;
}) {
  return (
    <button
      type="button"
      disabled={pending || !state.enabled}
      onClick={() => onPick(trigger)}
      data-testid={`dock-button-${capabilityId}`}
      title={state.enabled ? undefined : state.reason}
      className="mono text-[11px] tracking-[0.06em] px-3 py-1.5 border border-(--color-rule) text-(--color-ink) hover:border-(--color-ink) disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {title}
    </button>
  );
}

// capState —— 从 capability store 取某能力的可用/禁用理由。找不到（该 session 没这能力）→ 禁用。
function capState(
  caps: readonly { id: string; enabled: boolean; policy_summary?: string }[],
  id: string,
): DockCapState {
  const c = caps.find((x) => x.id === id);
  return c
    ? { enabled: c.enabled, reason: c.policy_summary ?? 'unavailable right now' }
    : { enabled: false, reason: 'unavailable right now' };
}

// ── footnote ───────────────────────────────────────────────

function ChatFootnote({ handle, mode }: { handle: string; mode: string }) {
  const t = useTranslations('visitor.chatRoom');
  return (
    <p className="mono text-[10px] leading-[1.7] text-(--color-faint) mt-3 mb-10">
      {t.rich('footnote', {
        handle,
        muted: (c) => <span className="text-(--color-muted)">{c}</span>,
      })}
      {mode === 'coded' && t('footnoteCoded', { handle })}
      {mode === 'byoai' && t('footnoteByoai')}
    </p>
  );
}
