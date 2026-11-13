// CueFeed —— the live cue feed rendered the one way, shared by /admin/screen-assistant and the
// full-screen /cue page so the two never drift. Grouped into turns — each interviewer line (muted,
// accent rule) with the cue card(s) it drew below it, the owner's own answer indented — with the
// newest turn on top, so the current question and its cue are always in view without scrolling. A cue
// is markdown (GFM tables for the choice matrix); the leading letters are bold for faster reading.

'use client';

import { Children, Fragment, type ReactNode } from 'react';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { bionicPieces } from '@/lib/admin/bionic';
import type { AssistantEvent } from '@/lib/admin/use-screen-assistant';

// cueClass —— the cue card: accent rule on the left, GFM choice-matrix tables scroll sideways on a
// phone instead of squeezing the words.
const cueClass =
  'reading text-[16px] border-l-2 border-(--color-accent) pl-4 overflow-x-auto [&_table]:my-3 [&_table]:border-collapse [&_table]:text-[14px] [&_th]:mono [&_th]:text-[11px] [&_th]:text-left [&_th]:border-b [&_th]:border-(--color-rule) [&_th]:px-2 [&_th]:py-1 [&_td]:border-b [&_td]:border-(--color-rule) [&_td]:px-2 [&_td]:py-1 [&_td]:align-top';

// groupTurns —— split the feed into turns: an interviewer line ('heard') starts a turn; the cue cards
// and the owner's answers that follow attach to it (a leading card with no question yet is its own
// turn).
function groupTurns(events: readonly AssistantEvent[]): AssistantEvent[][] {
  const turns: AssistantEvent[][] = [];
  for (const e of events) addToTurns(turns, e);
  return turns;
}

// addToTurns —— a 'heard' line opens a new turn; a cue/answer attaches to the open turn (or opens one
// if none is open yet).
function addToTurns(turns: AssistantEvent[][], e: AssistantEvent): void {
  const open = turns.at(-1);
  void (e.kind !== 'heard' && open ? open.push(e) : turns.push([e]));
}

export function CueFeed({ events }: { events: readonly AssistantEvent[] }) {
  const turns = groupTurns(events).reverse(); // newest turn first
  return (
    <div className="flex flex-col gap-6">
      {turns.map((turn) => (
        <section key={`${turn[0]!.kind}-${turn[0]!.id}`} className="flex flex-col gap-3">
          {turn.map((e) => <Turn key={`${e.kind}-${e.id}`} event={e} />)}
        </section>
      ))}
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
