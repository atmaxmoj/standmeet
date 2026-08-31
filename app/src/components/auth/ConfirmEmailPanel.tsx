// ConfirmEmailPanel —— 确认信里那条链接的落地页。
//
// 三种结局各说各的话。**"过期"和"无效"必须分开** —— owner 下一步该做什么完全不同：
// 过期 = 回面板再点一次保存（那条路还在）；无效 = 这封信不是给你的 / 已经用过了。
// 压成一句"链接有问题"的话，为过期准备的那句指引就永远出不来。
//
// 呈现层不做判断：状态机在 useConfirmEmail 里，这里只按 kind 选一块渲染。

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

// OUTCOMES —— kind → 渲染哪一块。查表而不是四个三元：呈现层的分支上限是 3，
// 而且加一种结局时改的是这张表，不是一条越来越长的链子。
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
