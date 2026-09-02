// /setup — entry point for the first-run claim wizard.
//
// The setup token is read from the query string `?t=...`. With no token, it shows
// a "missing token" hint instead of the form. The token is printed to stdout on
// backend startup and written to /srv/first-run.txt; the owner copies the URL
// from there to open it.
//
// useSearchParams is a client API, and Next 15 requires wrapping it in Suspense.

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
