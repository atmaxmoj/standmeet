// AgentWidget —— the agent entry, and the ONE that inherits from the access code.
//
// Two states, decided structurally (never a per-block choice in this file):
//   • No grant  → an ask box that hands off to /gate (carrying the question). A codeless visitor
//                 can't chat inline — the corpus is gated — so this is a click-through to /gate.
//   • Has grant → the code's agent, inline. It ADOPTS the stored session (useChatSession does this
//                 for us), so corpus scope + persona + quota + accounting all come from the code
//                 with nothing to wire; and it renders the code's dock buttons straight from the
//                 stored blob (adoptedDockButtons) — whatever the owner configured on the role
//                 shows up, so a NEW block inherits with no change here.
//
// The parity that "the embedded agent inherits everything the non-embedded one grants" is enforced
// by a test, not asserted by this widget (embedded-agent-inherits-structurally).

'use client';

import React, { useEffect, useState } from 'react';
import {
  adoptedDockButtons, byoaiOffered, hasVisitorGrant, keyStorageAvailable, publicChatEnabled,
  type AdoptedDockButton,
} from '@standmeet/sdk-core';

import { StandMeetProvider } from '../provider.js';
import { useChatSession, type ChatMessage, type ChatState } from '../use-chat-session.js';
import { AnswerText } from '../AnswerText.js';
import { gateHref } from './client.js';
import { McpAppCard } from './McpAppCard.js';
import { ByokPanel } from './ByokPanel.js';
import { useT, type T } from '../i18n.js';

export interface AgentWidgetProps {
  readonly placeholder?: string;
  readonly examples?: readonly string[];
}

export function AgentWidget(props: AgentWidgetProps): React.ReactElement {
  // Two things decide inline-vs-gate, both read after mount (localStorage / the injected meta) so a
  // client-rendered microsite never flashes the wrong state:
  //   • a stored grant (arrived with a code) → the code's agent, inline; OR
  //   • the owner wired a public inference provider (publicChatEnabled) → answer a codeless visitor
  //     inline over the public tier.
  // Neither, but this browser can hold a key → the visitor brings their own (owner decision
  // 2026-09-25: out of quota → offer BYOK, not a dead-end redirect). Otherwise the gate handoff.
  // 'gate' until resolved, so a client-rendered microsite never flashes the wrong state.
  const [mode, setMode] = useState<WidgetMode>('gate');
  useEffect(() => { setMode(widgetMode()); }, []);

  return mode === 'gate'
    ? <GateHandoff placeholder={props.placeholder} examples={props.examples} />
    : <StandMeetProvider baseURL=""><InlineAgent needsKey={mode === 'byok'} /></StandMeetProvider>;
}

type WidgetMode = 'inline' | 'byok' | 'gate';

// widgetMode —— a grant or the owner's usable public tier → inline; else the visitor's own key
// when this page can store one (a secure context); else the gate.
function widgetMode(): WidgetMode {
  if (hasVisitorGrant() || publicChatEnabled()) return 'inline';
  return keyStorageAvailable() ? 'byok' : 'gate';
}

// GateHandoff —— codeless: the ask box carries the question to /gate.
function GateHandoff({ placeholder, examples }: AgentWidgetProps): React.ReactElement {
  const t = useT();
  const [q, setQ] = useState('');
  const ask = (question: string) => { window.location.href = gateHref(question); };
  return (
    <section data-testid="agent-widget" data-mode="gate" className="w-full">
      <form
        className="flex items-center gap-3 border-b border-(--color-ink)/25 focus-within:border-(--color-accent) transition-colors pb-2"
        onSubmit={(e) => { e.preventDefault(); ask(q); }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder ?? t('askPlaceholder')}
          aria-label={t('askLabel')}
          data-testid="agent-widget-input"
          className="flex-1 bg-transparent font-serif text-[20px] text-(--color-ink) placeholder:text-(--color-faint) outline-none"
        />
        <button
          type="submit"
          data-testid="agent-widget-ask"
          className="mono text-[11px] tracking-[0.14em] uppercase text-(--color-accent) hover:tracking-[0.2em] transition-all shrink-0"
        >
          {t('ask')}
        </button>
      </form>
      {examples !== undefined && examples.length > 0 && (
        <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
          {examples.map((ex) => (
            <li key={ex}>
              <button
                type="button"
                onClick={() => ask(ex)}
                className="text-left font-serif italic text-(--color-muted) hover:text-(--color-accent) transition-colors text-[16px] leading-[1.4]"
              >
                &ldquo;{ex}&rdquo;
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// InlineAgent —— granted: the code's agent, inline. Corpus/persona/quota inherit through the
// adopted session; the dock buttons inherit through the stored blob. needsKey: the owner's public
// tier can't serve, so the visitor asks on their own key (ByokPanel) until one is in use.
function InlineAgent({ needsKey }: { readonly needsKey: boolean }): React.ReactElement {
  // adopted grant overrides this input; a saved key is used up front only when the owner has no quota
  const chat = useChatSession({ mode: 'public' }, { autoUseSavedKey: needsKey });
  const t = useT();
  const [dock, setDock] = useState<readonly AdoptedDockButton[]>([]);
  const [draft, setDraft] = useState('');
  // offerTaken —— the visitor opened the BYOK panel from an offer (rate-limited / page allows it).
  const [offerTaken, setOfferTaken] = useState(false);
  const [offerable, setOfferable] = useState(false);
  useEffect(() => { setDock(adoptedDockButtons()); setOfferable(byoaiOffered()); }, []);
  // Never for a coded visitor (chat.byok.available): the code's owner pays for their turns.
  const canOffer = chat.byok.available && !chat.byok.active;
  // A saved key that can't be read (or that the server says never arrived) → ask for it again.
  const keyLost = KEY_LOST_CODES.has(chat.errorCode ?? '');
  const showPanel = canOffer && (needsKey || offerTaken || keyLost);
  const showOffer = canOffer && !showPanel && (chat.errorCode === 'rate_limited' || offerable);

  const send = (text: string) => {
    const q = text.trim();
    if (q === '' || chat.streaming) return;
    setDraft('');
    void chat.send(q);
  };

  return (
    // data-dock-count —— how many buttons the adopt effect actually resolved.
    //
    // Without it, "the code configured no dock", "the blob lost them" and "the guard dropped them"
    // all render as the same thing: no button. That ambiguity cost a full diagnosis round, in which
    // seven separate hypotheses had to be killed one at a time from the outside. The count is the
    // one number that separates them, and it belongs next to data-mode, which is here for exactly
    // the same reason.
    <section
      data-testid="agent-widget" data-mode={needsKey ? 'byok' : 'inline'} data-dock-count={dock.length}
      className="w-full"
    >
      {/* Clear/new-conversation — the visitor can wipe this page's stored chat. Icon-only (↺) so it
          reads the same in any language the microsite is in. Shown only once there's something to clear. */}
      {chat.messages.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.75rem' }}>
          <button
            type="button"
            data-testid="agent-widget-clear"
            onClick={() => chat.clear()}
            aria-label={t('newConversation')}
            title={t('newConversation')}
            className="mono text-[11px] text-(--color-faint) hover:text-(--color-accent) transition-colors"
          >
            {CLEAR_GLYPH}
          </button>
        </div>
      )}

      {/* Inline structural layout (see CorpusWidget): without it a consumer that doesn't compile
          `flex-col` runs the chat transcript horizontally. */}
      <ol data-testid="agent-widget-transcript" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', listStyle: 'none', padding: 0, margin: '0 0 1.5rem' }}>
        {chat.messages.map((m) => (
          <li key={m.id} data-role={m.role}>
            {m.role === 'visitor'
              ? <p className="mono text-[12px] tracking-[0.04em] text-(--color-muted)">{m.text}</p>
              : <div className="font-serif text-(--color-ink) text-[18px] leading-[1.6]">
                  <AnswerText text={m.text} />
                  {/* The tool's own card (ask_visitor's question): answering it sends the
                      choice as the visitor's next message, same as the main chat. */}
                  {(m.cards ?? []).map((c, i) => (
                    <McpAppCard key={`${c.tool}-${i}`} card={c} onAsk={send} />
                  ))}
                </div>}
          </li>
        ))}
      </ol>

      {chat.streaming && lastIsEmptyAssistant(chat.messages) && (
        <ChatThrobber label={chat.tool?.label ?? t('thinking')} />
      )}

      {chat.error !== null && (
        <p data-testid="agent-widget-error" className="mono text-[11px] text-(--color-accent) mb-3">
          {errorText(chat, t)}
        </p>
      )}

      <ByokControls
        chat={chat} t={t} showPanel={showPanel} showOffer={showOffer}
        onOffer={() => { if (chat.byok.saved) chat.byok.useSaved(); else setOfferTaken(true); }}
      />

      {dock.length > 0 && (
        <div data-testid="agent-widget-dock" className="flex flex-wrap gap-2 mb-4">
          {dock.map((b) => (
            <button
              key={b.block_id}
              type="button"
              onClick={() => send(b.trigger)}
              data-testid={`agent-widget-dock-${b.block_id}`}
              className="mono text-[11px] tracking-[0.06em] border border-(--color-rule) hover:border-(--color-accent) hover:text-(--color-accent) transition-colors rounded-[3px] px-3 py-1.5"
            >
              {b.title}
            </button>
          ))}
        </div>
      )}

      <form
        className="flex items-center gap-3 border-b border-(--color-ink)/25 focus-within:border-(--color-accent) transition-colors pb-2"
        onSubmit={(e) => { e.preventDefault(); send(draft); }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={askPlaceholder(t, chat.streaming, showPanel && needsKey)}
          aria-label={t('askLabel')}
          data-testid="agent-widget-input"
          disabled={chat.streaming || (showPanel && needsKey)}
          className="flex-1 bg-transparent font-serif text-[20px] text-(--color-ink) placeholder:text-(--color-faint) outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          data-testid="agent-widget-ask"
          disabled={chat.streaming}
          className="mono text-[11px] tracking-[0.14em] uppercase text-(--color-accent) hover:tracking-[0.2em] transition-all shrink-0 disabled:opacity-50"
        >
          {t('ask')}
        </button>
      </form>
    </section>
  );
}

// A glyph, not a word: the button's words are its aria-label and title.
const CLEAR_GLYPH = '↺';

function askPlaceholder(t: T, streaming: boolean, needsKey: boolean): string {
  if (streaming) return `${t('thinking')}…`;
  return t(needsKey ? 'needKeyPlaceholder' : 'askPlaceholder');
}

// errorText —— a known error code speaks the visitor's language; otherwise the server's own
// (English) sentence, which is still better than nothing.
function errorText(chat: ChatState, t: T): string | null {
  if (chat.errorCode === 'rate_limited') return t('errRateLimited');
  if (KEY_LOST_CODES.has(chat.errorCode ?? '')) return t('errKeyUnreadable');
  return chat.error;
}

// KEY_LOST_CODES —— the visitor's own key didn't reach the provider: this browser can't read the
// saved key (byoai_key_unreadable, caught before sending), or the server got none (byoai_key_required).
const KEY_LOST_CODES = new Set(['byoai_key_unreadable', 'byoai_key_required']);

// ByokControls —— the visitor's-own-key affordances: an offer when the owner's tier can't serve
// this turn (rate-limited) or the page allows BYOK, the panel to enter a key, and — once a key is
// in use — which one, with a way to forget it.
function ByokControls({ chat, t, showPanel, showOffer, onOffer }: {
  readonly chat: ChatState;
  readonly t: T;
  readonly showPanel: boolean;
  readonly showOffer: boolean;
  readonly onOffer: () => void;
}): React.ReactElement {
  return (
    <>
      {showOffer && (
        <button
          type="button" data-testid="agent-widget-byok-offer" onClick={onOffer}
          className="mb-3 mono text-[11px] tracking-[0.06em] text-(--color-accent) underline"
        >
          {t(chat.byok.saved ? 'useSavedKey' : 'useOwnKey')}
        </button>
      )}
      {showPanel && <ByokPanel onUse={chat.byok.use} />}
      {chat.byok.active && (
        <p
          data-testid="agent-widget-byok-active"
          className="mb-3 mono text-[10.5px] text-(--color-faint) flex gap-2"
        >
          <span>{t('onYourKey', { provider: chat.byok.provider ?? '' })}</span>
          <button
            type="button" data-testid="agent-widget-byok-forget" onClick={chat.byok.forget}
            className="underline hover:text-(--color-accent)"
          >
            {t('forgetKey')}
          </button>
        </p>
      )}
    </>
  );
}

// lastIsEmptyAssistant —— the turn is mid-flight before any answer token: the trailing message is an
// assistant bubble still empty. That's when the throbber shows (once text streams, the answer itself
// is the indicator).
function lastIsEmptyAssistant(messages: readonly ChatMessage[]): boolean {
  const last = messages.at(-1);
  return last !== undefined && last.role === 'assistant' && last.text === '';
}

// ChatThrobber —— the progress line while the agent works, matching the main chat's throb: the tool's
// progress copy ("searching corpus" / "reading X") when a tool is running, else "thinking", followed
// by three pulsing dots. Self-contained animation (staggered animate-pulse), so it works the same in
// a microsite build and in the app.
function ChatThrobber({ label }: { readonly label: string }): React.ReactElement {
  return (
    <div
      data-testid="agent-widget-throbber"
      className="mono text-[11px] tracking-[0.18em] uppercase text-(--color-muted) mb-3"
    >
      <span data-testid="agent-widget-throbber-label">{label}</span>
      <span aria-hidden="true" className="ml-1 inline-flex gap-0.5">
        <span className="animate-pulse" style={{ animationDelay: '0ms' }}>·</span>
        <span className="animate-pulse" style={{ animationDelay: '200ms' }}>·</span>
        <span className="animate-pulse" style={{ animationDelay: '400ms' }}>·</span>
      </span>
    </div>
  );
}
