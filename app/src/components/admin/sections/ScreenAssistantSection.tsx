// ScreenAssistantSection —— /admin/screen-assistant. The desktop cue app (modified from Cheating
// Daddy) listens on the owner's computer and streams what it heard and its cue cards here over
// MCP, so the owner can read the cards on a phone logged into admin — the desktop window can stay
// minimized. Newest first; leading letters bold (the owner reads faster that way).

'use client';

import { Children, Fragment, type ReactNode } from 'react';

import { useTranslations } from 'next-intl';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { bionicPieces } from '@/lib/admin/bionic';
import { useScreenAssistant, type AssistantEvent } from '@/lib/admin/use-screen-assistant';

// DOWNLOAD_URL —— the desktop app's builds (the fork's GitHub releases; GPL-3.0, source alongside).
const DOWNLOAD_URL = 'https://github.com/atmaxmoj/cheating-daddy/releases/latest';
const UPSTREAM_URL = 'https://github.com/sohzm/cheating-daddy';

export function ScreenAssistantSection() {
  const t = useTranslations('adminJobs');
  const { events, error } = useScreenAssistant();
  return (
    <>
      <SectionHeader kicker={t('screenAssistant.kicker')} slug="screen-assistant" />
      <p className="reading text-[15px] mb-3 max-w-[60ch]">{t('screenAssistant.intro')}</p>
      <div className="mb-8 flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <a href={DOWNLOAD_URL} data-testid="assistant-download" className="sm-btn sm-btn-sm">
          {t('screenAssistant.download')}
        </a>
        <span className="mono text-[11px] text-(--color-muted)">
          {t.rich('screenAssistant.credit', {
            upstream: (c) => <a href={UPSTREAM_URL} className="underline">{c}</a>,
          })}
        </span>
      </div>
      {error && <p className="mono text-[11px] text-(--color-accent) mb-4">{error}</p>}
      {events.length === 0 ? <Empty /> : <Feed events={events} />}
    </>
  );
}

function Empty() {
  const t = useTranslations('adminJobs');
  return (
    <div className="sm-empty">
      <div className="sm-smallcaps mb-1.5">{t('screenAssistant.emptyKicker')}</div>
      <p className="sm-empty-hint reading">{t('screenAssistant.emptyHint')}</p>
    </div>
  );
}

function Feed({ events }: { events: readonly AssistantEvent[] }) {
  return (
    <div className="flex flex-col gap-5">
      {[...events].reverse().map((e) => e.kind === 'heard'
        ? (
          <p key={`h-${e.id}`} data-testid="assistant-heard" className="mono text-[12px] text-(--color-muted)">
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
