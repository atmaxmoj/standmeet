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
  adoptedDockButtons, hasVisitorGrant, publicChatEnabled, type AdoptedDockButton,
} from '@standmeet/sdk-core';

import { StandMeetProvider } from '../provider.js';
import { useChatSession, type ChatMessage } from '../use-chat-session.js';
import { AnswerText } from '../AnswerText.js';
import { gateHref } from './client.js';

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
  // Neither → the gate handoff (the pre-public-inference behavior). Default false until resolved.
  const [inline, setInline] = useState(false);
  useEffect(() => { setInline(hasVisitorGrant() || publicChatEnabled()); }, []);

  return inline
    ? <StandMeetProvider baseURL=""><InlineAgent /></StandMeetProvider>
    : <GateHandoff placeholder={props.placeholder} examples={props.examples} />;
}

// GateHandoff —— codeless: the ask box carries the question to /gate.
function GateHandoff({ placeholder, examples }: AgentWidgetProps): React.ReactElement {
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
          placeholder={placeholder ?? 'Ask anything…'}
          aria-label="Ask a question"
          data-testid="agent-widget-input"
          className="flex-1 bg-transparent font-serif text-[20px] text-(--color-ink) placeholder:text-(--color-faint) outline-none"
        />
        <button
          type="submit"
          data-testid="agent-widget-ask"
          className="mono text-[11px] tracking-[0.14em] uppercase text-(--color-accent) hover:tracking-[0.2em] transition-all shrink-0"
        >
          ask ↗
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
// adopted session; the dock buttons inherit through the stored blob.
function InlineAgent(): React.ReactElement {
  const chat = useChatSession({ mode: 'public' }); // adopted grant overrides this input
  const [dock, setDock] = useState<readonly AdoptedDockButton[]>([]);
  const [draft, setDraft] = useState('');
  useEffect(() => { setDock(adoptedDockButtons()); }, []);

  const send = (text: string) => {
    const t = text.trim();
    if (t === '' || chat.streaming) return;
    setDraft('');
    void chat.send(t);
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
      data-testid="agent-widget" data-mode="inline" data-dock-count={dock.length}
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
            aria-label="New conversation"
            title="New conversation"
            className="mono text-[11px] text-(--color-faint) hover:text-(--color-accent) transition-colors"
          >
            ↺
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
                </div>}
          </li>
        ))}
      </ol>

      {chat.streaming && lastIsEmptyAssistant(chat.messages) && (
        <ChatThrobber label={chat.tool?.label ?? 'thinking'} />
      )}

      {chat.error !== null && (
        <p data-testid="agent-widget-error" className="mono text-[11px] text-(--color-accent) mb-3">
          {chat.error}
        </p>
      )}

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
          placeholder={chat.streaming ? 'thinking…' : 'Ask anything…'}
          aria-label="Ask a question"
          data-testid="agent-widget-input"
          disabled={chat.streaming}
          className="flex-1 bg-transparent font-serif text-[20px] text-(--color-ink) placeholder:text-(--color-faint) outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          data-testid="agent-widget-ask"
          disabled={chat.streaming}
          className="mono text-[11px] tracking-[0.14em] uppercase text-(--color-accent) hover:tracking-[0.2em] transition-all shrink-0 disabled:opacity-50"
        >
          ask ↗
        </button>
      </form>
    </section>
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
