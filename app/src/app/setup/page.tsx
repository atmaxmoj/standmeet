// /setup —— first-run claim wizard 入口。
//
// Setup token 从 query string `?t=...` 读，没 token 就显示"missing token"
// 提示而不是表单。token 在 backend 启动时打印到 stdout + 写 /srv/first-run.txt，
// owner 从那里复制 URL 打开。
//
// useSearchParams 是 client API + Next 15 要求外面包 Suspense。

'use client';

import { useTranslations } from 'next-intl';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

import { AuthShell } from '@/components/auth/AuthShell';
import { SetupForm } from '@/components/auth/SetupForm';

export default function SetupPage() {
  return (
    <AuthShell>
      <Suspense fallback={<SetupLoading />}>
        <SetupBodyWithParams />
      </Suspense>
    </AuthShell>
  );
}

function SetupBodyWithParams() {
  const params = useSearchParams();
  const token = params.get('t') ?? '';
  return token === '' ? <MissingToken /> : <SetupForm setupToken={token} />;
}

function SetupLoading() {
  const t = useTranslations('auth.setupPage');
  return <p className="mono text-(--color-muted)">{t('loading')}</p>;
}

function MissingToken() {
  const t = useTranslations('auth.setupPage');
  return (
    <section className="max-w-md">
      <h1 className="reading text-2xl mb-4">{t('missingHeading')}</h1>
      <p className="reading text-(--color-muted)">
        {t.rich('missingHelp', {
          code: (chunks) => <code className="mono">{chunks}</code>,
        })}
      </p>
    </section>
  );
}
