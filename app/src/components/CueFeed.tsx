// CueFeed —— the live cue feed rendered the one way, shared by /admin/screen-assistant and the
// full-screen /cue page so the two never drift. A conversation flow like the desktop cue app: oldest
// first, newest at the bottom, each interviewer line (muted, accent rule) followed by the cue card it
// drew (a cue is markdown with GFM tables; leading letters bold for faster reading); the owner's own
// answer sits indented. The view auto-scrolls to the newest as cards stream in.

'use client';

import { Children, Fragment, useEffect, useRef, type ReactNode } from 'react';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { bionicPieces } from '@/lib/admin/bionic';
import type { AssistantEvent } from '@/lib/admin/use-screen-assistant';

// cueClass —— the cue card: accent rule on the left, GFM choice-matrix tables scroll sideways on a
// phone instead of squeezing the words.
const cueClass =
  'reading text-[16px] border-l-2 border-(--color-accent) pl-4 overflow-x-auto [&_table]:my-3 [&_table]:border-collapse [&_table]:text-[14px] [&_th]:mono [&_th]:text-[11px] [&_th]:text-left [&_th]:border-b [&_th]:border-(--color-rule) [&_th]:px-2 [&_th]:py-1 [&_td]:border-b [&_td]:border-(--color-rule) [&_td]:px-2 [&_td]:py-1 [&_td]:align-top';

export function CueFeed({ events }: { events: readonly AssistantEvent[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  const latest = events[events.length - 1];
  // Follow the newest line/card as it streams in — the interviewer is talking now, the owner wants
  // the freshest cue in view without scrolling.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [events.length, latest?.text]);
  return (
    <div className="flex flex-col gap-5">
      {events.map((e) => <Turn key={`${e.kind}-${e.id}`} event={e} />)}
      <div ref={endRef} aria-hidden />
    </div>
  );
}

// Turn —— one feed entry: the interviewer's line (muted, accent rule), the owner's own answer
// (indented, kept for review), or the cue card it drew.
function Turn({ event }: { event: AssistantEvent }) {
  return event.kind === 'heard'
    ? (
      <p data-testid="assistant-heard" className="mono text-[12px] text-(--color-muted) border-l-2 border-(--color-rule) pl-3">
        {event.text}
      </p>
    )
    : event.kind === 'said'
    ? (
      <p data-testid="assistant-said" className="mono text-[12px] text-(--color-muted) italic pl-6">
        {event.text}
      </p>
    )
    : (
      <article data-testid="assistant-cue" className={cueClass}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ p: Lead, li: LeadLi, td: LeadTd }}>{event.text}</ReactMarkdown>
      </article>
    );
}

// bionic —— bold the leading letters of plain-text children; elements (strong, em, …) pass through.
function bionic(children: ReactNode): ReactNode {
  return Children.map(children, (node) => typeof node === 'string'
    ? bionicPieces(node).map((p, i) => <Fragment key={i}><b>{p.lead}</b>{p.rest}</Fragment>)
    : node);
}

function Lead({ children }: { children?: ReactNode }) {
  return <p className="mb-2">{bionic(children)}</p>;
}

function LeadLi({ children }: { children?: ReactNode }) {
  return <li className="ml-5 list-disc mb-1">{bionic(children)}</li>;
}

function LeadTd({ children }: { children?: ReactNode }) {
  return <td>{bionic(children)}</td>;
}
