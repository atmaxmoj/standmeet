// ConversationDeck —— inline 累加的 Q/A 流，每个 Turn 一张卡：
//   you · HH:MM
//   <serif italic question>
//   alice's ai
//   <answer body  OR  retrieving · · ·>
//   <citations 列表>
//
// 这是公开页 chat 的"主表演" —— visitor 问完不滚出去看个 modal，而是在
// 页面 inline 累加，跟 Hero 同一根纵向阅读流上，符合设计稿"transcript
// flow, not alternating bubbles"。

'use client';

import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';

import { DeckHeader } from './DeckHeader';
import type { Citation, Turn, TurnAnswer } from '@/lib/page/use-conversation';

type Props = {
  ownerHandle: string;
  turns: Turn[];
  onReset: () => void;
};

export function ConversationDeck({ ownerHandle, turns, onReset }: Props) {
  return (
    <section id="conversation" className="mt-16" data-testid="conversation-deck">
      <DeckHeader
        kicker="conversation"
        count={turns.length}
        action={
          <button
            type="button"
            onClick={onReset}
            className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-muted) hover:text-(--color-accent) transition-colors"
          >
            ↺ reset
          </button>
        }
      />
      {turns.map((t, i) => <TurnCard key={t.id} idx={i} turn={t} ownerHandle={ownerHandle} />)}
    </section>
  );
}

function TurnCard({ idx, turn, ownerHandle }: { idx: number; turn: Turn; ownerHandle: string }) {
  return (
    <article id={`qa-${idx}`} className="pt-10 pb-10 border-b border-(--color-rule)">
      <VisitorLabel time={turn.time} />
      <p
        className="font-serif italic mb-7"
        style={{ fontSize: '22px', lineHeight: 1.3, fontWeight: 380, letterSpacing: '-0.003em', textWrap: 'pretty' }}
      >
        {turn.q}
      </p>
      <AssistantBody turn={turn} ownerHandle={ownerHandle} />
    </article>
  );
}

function VisitorLabel({ time }: { time: string }) {
  return (
    <div className="mono text-[10.5px] tracking-[0.18em] uppercase mb-3 flex items-baseline gap-3">
      <span className="text-(--color-ink)">you</span>
      <span className="text-(--color-faint) normal-case tracking-[0.06em]">· {time}</span>
    </div>
  );
}

function AssistantBody({ turn, ownerHandle }: { turn: Turn; ownerHandle: string }) {
  return turn.pending
    ? <Thinking />
    : <AnswerOrError turn={turn} ownerHandle={ownerHandle} />;
}

function AnswerOrError({ turn, ownerHandle }: { turn: Turn; ownerHandle: string }) {
  return (
    <>
      <AssistantLabel ownerHandle={ownerHandle} />
      {turn.answer && <Answer answer={turn.answer} />}
    </>
  );
}

function AssistantLabel({ ownerHandle }: { ownerHandle: string }) {
  return (
    <div className="mono text-[10.5px] tracking-[0.18em] uppercase text-(--color-accent) mb-3">
      {ownerHandle}&rsquo;s ai
    </div>
  );
}

function Thinking() {
  return (
    <div className="mono text-(--color-muted) text-[11px] tracking-[0.18em] uppercase mt-3">
      retrieving{' '}
      <span className="dot">·</span>
      <span className="dot">·</span>
      <span className="dot">·</span>
    </div>
  );
}

function Answer({ answer }: { answer: TurnAnswer }) {
  return (
    <div>
      <AnswerScopeLabel answer={answer} />
      <AnswerParas answer={answer} />
      <Citations citations={answer.citations} />
      <CitedCount answer={answer} />
    </div>
  );
}

function AnswerScopeLabel({ answer }: { answer: TurnAnswer }) {
  const scope = pickScope(answer);
  return scope === '' ? null : <ScopeBadge text={scope} />;
}

function pickScope(answer: TurnAnswer): string {
  return answer.byoaiBlocked
    ? 'public scope only · need a code'
    : answer.private ? 'private · layered access' : '';
}

function ScopeBadge({ text }: { text: string }) {
  return (
    <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-accent) mb-3">
      {text}
    </div>
  );
}

function AnswerParas({ answer }: { answer: TurnAnswer }) {
  const gated = answer.private || answer.byoaiBlocked;
  const cls = gated ? 'pl-5 border-l-2 border-(--color-accent)/40' : '';
  return (
    <div className={cls} data-testid="answer-body">
      {answer.paras.map((p, i) => (
        <div key={i} className="reading mb-4 last:mb-0" style={{ fontSize: '18px' }}>
          <ReactMarkdown rehypePlugins={[rehypeRaw]}>{p}</ReactMarkdown>
        </div>
      ))}
    </div>
  );
}

function Citations({ citations }: { citations: readonly Citation[] }) {
  return citations.length === 0 ? null : (
    <div className="mt-6">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2">drawn from</div>
      <ul className="space-y-1">
        {citations.map((c, i) => (
          <li key={i} className="flex items-baseline gap-3">
            <span className="mono text-[11.5px] text-(--color-muted) tabular-nums shrink-0">{c.date}</span>
            <span className="font-serif italic text-(--color-muted)" style={{ fontSize: '14.5px' }}>{c.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CitedCount({ answer }: { answer: TurnAnswer }) {
  const count = countCited(answer);
  return count === 0 ? null : (
    <p className="mono text-[10.5px] tracking-[0.18em] uppercase text-(--color-muted) mt-4" data-testid="cited">
      grounded in {count} corpus {count === 1 ? 'entry' : 'entries'}
    </p>
  );
}

function countCited(answer: TurnAnswer): number {
  return answer.citations.length > 0 ? 0 : answer.cited.length;
}
