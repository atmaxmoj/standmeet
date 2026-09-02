// Hero —— the public page's first screen: identity strip (mono small caps
// name · location) + a large serif prose paragraph + AskInput + an italic
// "some examples" list.
//
// AskInput state is kept by the caller (PageShell), so a Conversation Turn
// can receive the same onAsk callback and push the question into the
// conversation.

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
  // H.13.d: the ghost-text trio is threaded through from PageShell; it's
  // non-null only for a code-accessor.
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
          // This home-page field **behaves differently** from the one in a
          // conversation (Enter with no session = hand off to /gate), so it
          // needs its own name (F-Q-3). When two fields share a name, anything
          // that finds a control by name can't tell which one it typed into,
          // and typing into the wrong one looks exactly like "the product is
          // broken."
          testid="home-ask-field"
        />
        <Examples items={props.content.hero_examples} onPick={props.onAsk} />
      </div>
    </section>
  );
}

// nameLed —— the name already appears below as the large heading, so this
// strip doesn't repeat it and keeps only the location.
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

// HeroName —— **the fallback strategy for when there's no hero prose**.
//
// The design spec calls for "hero prose + chat input", but this instance
// hasn't configured hero prose, so that whole paragraph disappears and the
// biggest, most prominent line on the first screen becomes the "Ask
// anything." placeholder text inside the input — **a placeholder**. The name
// is reduced to a 10px mono label up top. This page is meant to replace
// LinkedIn / resume / blog, yet the page's identity ends up subordinate to an
// input hint (UX-43). The real defect is that **the empty state has no
// design**: nothing steps in when the primary copy is missing.
//
// The name is the one thing this page always has, so it steps in — rendered
// at the same large serif size as the prose it replaces.
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
