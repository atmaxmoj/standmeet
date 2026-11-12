// CueFeed —— the live cue feed rendered the one way, shared by /admin/screen-assistant and the
// full-screen /cue page so the two never drift. Newest first; a cue is markdown (GFM tables for the
// choice matrix); the leading letters are bold (bionic — the owner reads faster that way). The other
// side's line is muted, the owner's own answer is indented in ink.

'use client';

import { Children, Fragment, type ReactNode } from 'react';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { bionicPieces } from '@/lib/admin/bionic';
import type { AssistantEvent } from '@/lib/admin/use-screen-assistant';

export function CueFeed({ events }: { events: readonly AssistantEvent[] }) {
  return (
    <div className="flex flex-col gap-5">
      {[...events].reverse().map((e) => e.kind === 'heard'
        ? (
          <p key={`h-${e.id}`} data-testid="assistant-heard" className="mono text-[12px] text-(--color-muted)">
            {e.text}
          </p>
        )
        : e.kind === 'said'
        ? (
          // the owner's own answer: indented in ink, against the other side's muted line
          <p key={`s-${e.id}`} data-testid="assistant-said" className="mono text-[12px] pl-6">
            {e.text}
          </p>
        )
        : (
          <article
            key={`c-${e.id}`} data-testid="assistant-cue"
            // the choice matrix (a GFM table) scrolls sideways on a phone instead of squeezing the words
            className="reading text-[16px] border-l-2 border-(--color-accent) pl-4 overflow-x-auto [&_table]:my-3 [&_table]:border-collapse [&_table]:text-[14px] [&_th]:mono [&_th]:text-[11px] [&_th]:text-left [&_th]:border-b [&_th]:border-(--color-rule) [&_th]:px-2 [&_th]:py-1 [&_td]:border-b [&_td]:border-(--color-rule) [&_td]:px-2 [&_td]:py-1 [&_td]:align-top"
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ p: Lead, li: LeadLi, td: LeadTd }}>{e.text}</ReactMarkdown>
          </article>
        ))}
    </div>
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
