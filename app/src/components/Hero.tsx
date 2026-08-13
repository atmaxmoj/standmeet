// Hero —— 公开页第一屏：identity strip（mono small caps 名字 · 地点）+
// 大号 serif prose paragraph + AskInput + "some examples" italic 列表。
//
// AskInput 状态由 caller 维护（PageShell），方便 Conversation Turn 接收
// 同一个 onAsk callback 把问题塞进 conversation。

import type { RefObject } from 'react';
import { useTranslations } from 'next-intl';

import type { PageContent, PublicOwnerView } from '@/lib/api/public';

import { AskInput } from '@/components/page/AskInput';

type Props = {
  owner: PublicOwnerView;
  content: PageContent;
  input: string;
  setInput: (v: string) => void;
  onAsk: (q: string) => void;
  pending: boolean;
  lockedReason: string | null;
  inputRef: RefObject<HTMLInputElement | null>;
  // H.13.d: ghost text 三件套从 PageShell 透过来，code-accessor 才非 null。
  ghost: string | null;
  onAcceptGhost: (g: string) => void;
};

export function Hero(props: Props) {
  const named = props.content.hero_prose === '';
  return (
    <section className="pt-10 lg:pt-16">
      <IdentityStrip owner={props.owner} nameLed={named} />
      {named
        ? <HeroName name={props.owner.full_name} />
        : <HeroProse prose={props.content.hero_prose} />}
      <div className="mt-10">
        <AskInput
          value={props.input}
          onChange={props.setInput}
          onSubmit={props.onAsk}
          disabled={props.pending}
          lockedReason={props.lockedReason}
          inputRef={props.inputRef}
          ghost={props.ghost}
          onAcceptGhost={props.onAcceptGhost}
        />
        <Examples items={props.content.hero_examples} onPick={props.onAsk} />
      </div>
    </section>
  );
}

// nameLed —— 名字已经当大标题在下面出现了，这条 strip 就不再重复它，只留地点。
function IdentityStrip({ owner, nameLed }: { owner: PublicOwnerView; nameLed: boolean }) {
  return (
    <div className="mono text-[10.5px] tracking-[0.2em] uppercase text-(--color-muted) mb-5 flex items-baseline gap-3 flex-wrap">
      <StripName name={owner.full_name} show={!nameLed} />
      <StripLocation location={owner.location} sep={!nameLed} />
    </div>
  );
}

function StripName({ name, show }: { name: string; show: boolean }) {
  return show ? <span className="text-(--color-ink)">{name}</span> : null;
}

function StripLocation({ location, sep }: { location: string; sep: boolean }) {
  return location === '' ? null : (
    <>
      {sep && <span className="text-(--color-faint)">·</span>}
      <span>{location}</span>
    </>
  );
}

// HeroName —— **没有 hero prose 时的退化策略**。
//
// 设计源写的是「hero prose + chat input」，而这台实例没配 hero prose，于是那一段整个消失，
// 首屏最大最显眼的一行变成输入框里的 "Ask anything." —— **一个占位符**。名字则是顶部
// 一个 10px 的等宽小标签。这个面要替代的是 LinkedIn / 简历 / 博客，而页面的身份从属于
// 一个输入提示（UX-43）。真正的缺陷是**空态没有设计**：主文案缺席时没人接棒。
//
// 名字是这一页永远有的东西，所以由它接棒 —— 用跟 prose 同一档的衬线大号。
function HeroName({ name }: { name: string }) {
  return (
    <h1 className="font-serif text-(--color-ink) text-[clamp(26px,3.4vw,38px)] leading-[1.35] font-[380] tracking-[-0.012em] max-w-[26em]">
      {name}
    </h1>
  );
}

function HeroProse({ prose }: { prose: string }) {
  return (
    <p className="font-serif text-(--color-ink) text-[clamp(26px,3.4vw,38px)] leading-[1.35] font-[380] tracking-[-0.012em] [text-wrap:pretty] max-w-[26em]">
      {prose}
    </p>
  );
}

function Examples({ items, onPick }: { items: readonly string[]; onPick: (q: string) => void }) {
  const t = useTranslations('page');
  return items.length === 0 ? null : (
    <div className="mt-6">
      <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-faint) mb-3">
        {t('hero.someExamples')}
      </div>
      <ul className="space-y-1.5">
        {items.map((q) => (
          <li key={q} className="flex items-baseline gap-3">
            <span className="mono text-(--color-faint) shrink-0">·</span>
            <button
              type="button"
              onClick={() => onPick(q)}
              className="text-left font-serif italic text-(--color-muted) hover:text-(--color-accent) transition-colors text-[17px] leading-[1.4]"
            >
              &ldquo;{q}&rdquo;
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
