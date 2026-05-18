// Hero —— 公开页第一屏：identity strip（mono small caps 名字 · 地点）+
// 大号 serif prose paragraph + AskInput + "some examples" italic 列表。
//
// AskInput 状态由 caller 维护（PageShell），方便 Conversation Turn 接收
// 同一个 onAsk callback 把问题塞进 conversation。

import type { RefObject } from 'react';

import type { PageContent, PublicOwnerView } from '@/lib/api/public';

import { AskInput } from './page/AskInput';

type Props = {
  owner: PublicOwnerView;
  content: PageContent;
  input: string;
  setInput: (v: string) => void;
  onAsk: (q: string) => void;
  pending: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
};

export function Hero(props: Props) {
  return (
    <section className="pt-10 lg:pt-16">
      <IdentityStrip owner={props.owner} />
      <HeroProse prose={props.content.hero_prose} />
      <div className="mt-10">
        <AskInput
          value={props.input}
          onChange={props.setInput}
          onSubmit={props.onAsk}
          disabled={props.pending}
          inputRef={props.inputRef}
        />
        <Examples items={props.content.hero_examples} onPick={props.onAsk} />
      </div>
    </section>
  );
}

function IdentityStrip({ owner }: { owner: PublicOwnerView }) {
  return (
    <div className="mono text-[10.5px] tracking-[0.2em] uppercase text-(--color-muted) mb-5 flex items-baseline gap-3 flex-wrap">
      <span className="text-(--color-ink)">{owner.full_name}</span>
      {owner.location && <span className="text-(--color-faint)">·</span>}
      {owner.location && <span>{owner.location}</span>}
    </div>
  );
}

function HeroProse({ prose }: { prose: string }) {
  return (
    <p
      className="font-serif text-(--color-ink)"
      style={{
        fontSize: 'clamp(26px, 3.4vw, 38px)',
        lineHeight: 1.35,
        fontWeight: 380,
        letterSpacing: '-0.012em',
        textWrap: 'pretty',
        maxWidth: '26em',
      }}
    >
      {prose}
    </p>
  );
}

function Examples({ items, onPick }: { items: readonly string[]; onPick: (q: string) => void }) {
  return items.length === 0 ? null : (
    <div className="mt-6">
      <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-faint) mb-3">
        some examples
      </div>
      <ul className="space-y-1.5">
        {items.map((q) => (
          <li key={q} className="flex items-baseline gap-3">
            <span className="mono text-(--color-faint) shrink-0">·</span>
            <button
              type="button"
              onClick={() => onPick(q)}
              className="text-left font-serif italic text-(--color-muted) hover:text-(--color-accent) transition-colors"
              style={{ fontSize: '17px', lineHeight: 1.4 }}
            >
              &ldquo;{q}&rdquo;
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
