// ConfirmEmailPanel — landing page for the link in the confirmation email.
//
// Each of the three outcomes says something different. "Expired" and "invalid" must
// stay separate — the owner's next step differs completely: expired = go back to
// the panel and save again (that path still works); invalid = this email wasn't
// for you / was already used. Collapsing both into "link has a problem" means the
// guidance written for expired never surfaces.
//
// No judgment happens in this presentation layer: the state machine lives in
// useConfirmEmail, this file only picks which block to render by kind.

'use client';

import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';

import { useConfirmEmail, type ConfirmEmailState } from '@/lib/auth/use-confirm-email';

export function ConfirmEmailPanel() {
  const t = useTranslations('auth.confirmEmail');
  const token = useSearchParams().get('token') ?? '';
  const state = useConfirmEmail(token);
  return (
    <section className="rise max-w-[480px]">
      <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted) mb-3">
        {t('eyebrow')}
      </div>
      <ConfirmOutcome state={state} />
    </section>
  );
}

// OUTCOMES — kind → which block to render. A lookup table, not four ternaries:
// caps the presentation layer's branching at 3, and adding a new outcome means
// editing this table, not extending an ever-longer chain.
const OUTCOMES: Record<ConfirmEmailState['kind'], (s: ConfirmEmailState) => ReactNode> = {
  working: () => <Working />,
  confirmed: (s) => <Confirmed email={s.kind === 'confirmed' ? s.email : ''} />,
  expired: () => <Expired />,
  invalid: () => <Invalid />,
};

function ConfirmOutcome({ state }: { state: ConfirmEmailState }) {
  return <>{OUTCOMES[state.kind](state)}</>;
}

function Heading({ children }: { children: ReactNode }) {
  return (
    <h1 className="font-serif text-(--color-ink) text-[clamp(30px,4vw,42px)] font-normal tracking-[-0.02em] leading-tight">
      {children}<span className="text-(--color-accent)">.</span>
    </h1>
  );
}

function Body({ children, testid }: { children: ReactNode; testid: string }) {
  return (
    <p data-testid={testid} className="reading text-[14px] text-(--color-muted) mt-4">
      {children}
    </p>
  );
}

function Working() {
  const t = useTranslations('auth.confirmEmail');
  return (
    <>
      <Heading>{t('workingHeading')}</Heading>
      <Body testid="email-confirm-working">{t('workingBody')}</Body>
    </>
  );
}

function Confirmed({ email }: { email: string }) {
  const t = useTranslations('auth.confirmEmail');
  return (
    <>
      <Heading>{t('confirmedHeading')}</Heading>
      <Body testid="email-confirmed">
        {t('confirmedBody', { email })}{' '}
        <a className="underline" href="/login">{t('signInLink')}</a>
      </Body>
    </>
  );
}

function Expired() {
  const t = useTranslations('auth.confirmEmail');
  return (
    <>
      <Heading>{t('expiredHeading')}</Heading>
      <Body testid="email-confirm-expired">{t('expiredBody')}</Body>
    </>
  );
}

function Invalid() {
  const t = useTranslations('auth.confirmEmail');
  return (
    <>
      <Heading>{t('invalidHeading')}</Heading>
      <Body testid="email-confirm-invalid">{t('invalidBody')}</Body>
    </>
  );
}
