// CalendarConnectorPanel —— owner-facing Google Calendar connector card.
// 三块：
//   1. credentials form (client_id / client_secret)
//   2. status + Authorize button + Disconnect
//   3. booking policy editor —— 住在 `CalendarBookingPolicy.tsx`（连没连上 / 连上之后按什么
//      规矩排，是两件事，只是画在同一张卡上）
//
// 设计稿没专门画 GCal 卡，沿用 ConnectorTile 视觉语言（crosshair + mono
// kicker + 字段一列）。布局窄一档（max-w-[640px]）。

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { AdminSectionHead } from '@/components/admin/AdminSectionHead';
import { useGCal } from '@/lib/admin/use-gcal';
import { PolicyEditor } from '@/components/admin/sections/connectors/CalendarBookingPolicy';
import { useAction } from '@/lib/ui/use-action';
import { useReportError } from '@/lib/ui/use-report-error';

export function CalendarConnectorPanel() {
  const hook = useGCal();
  return (
    <section
      className="crosshair border border-(--color-rule) rounded-sm bg-(--color-surface)/30 p-5 max-w-[640px]"
      data-testid="gcal-connector-panel"
    >
      <span className="ch-tl" /><span className="ch-br" />
      <Header status={hook.status} />
      <CredentialsForm hook={hook} />
      <ConnectButtons hook={hook} />
      <PolicyEditor hook={hook} />
    </section>
  );
}

function Header({ status }: { status: ReturnType<typeof useGCal>['status'] }) {
  const t = useTranslations('adminIntegrations.calendar');
  return (
    <AdminSectionHead className="mb-4" aside={<StatusBadge status={status} />}>
      {t('heading')}
    </AdminSectionHead>
  );
}

function StatusBadge({ status }: { status: ReturnType<typeof useGCal>['status'] }) {
  return status === null
    ? null
    : <Badge tone={badgeTone(status)} text={badgeText(status)} />;
}

function badgeTone(s: NonNullable<ReturnType<typeof useGCal>['status']>): 'ok' | 'warn' | 'muted' {
  return s.connected ? 'ok' : s.has_credentials ? 'warn' : 'muted';
}

function badgeText(s: NonNullable<ReturnType<typeof useGCal>['status']>): string {
  return s.connected
    ? 'connected'
    : s.has_credentials
      ? 'credentials only · click Authorize'
      : 'not configured';
}

function Badge({ tone, text }: { tone: 'ok' | 'warn' | 'muted'; text: string }) {
  const color = tone === 'ok' ? 'text-(--color-accent)'
    : tone === 'warn' ? 'text-(--color-ink)'
    : 'text-(--color-faint)';
  return (
    <span
      className={`mono text-[10.5px] tracking-[0.10em] ${color}`}
      data-testid="gcal-status-badge"
    >
      {text}
    </span>
  );
}

// ─── credentials form ─────────────────────────────────────────

function CredentialsForm({ hook }: { hook: ReturnType<typeof useGCal> }) {
  const [clientID, setClientID] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  return (
    <div className="space-y-3 mb-5">
      <CredentialsHint />
      <CredentialsRow
        label="client_id"
        testid="gcal-client-id"
        type="text"
        value={clientID}
        onChange={setClientID}
        placeholder="123456789-abc.apps.googleusercontent.com"
      />
      <CredentialsRow
        label="client_secret"
        testid="gcal-client-secret"
        type="password"
        value={clientSecret}
        onChange={setClientSecret}
        placeholder="GOCSPX-..."
      />
      <SaveCredsButton hook={hook} clientID={clientID} clientSecret={clientSecret} />
    </div>
  );
}

function CredentialsHint() {
  const t = useTranslations('adminIntegrations.calendar');
  return (
    <p className="reading-tight text-[12.5px] text-(--color-muted) italic">
      {t('credentialsHint')}
    </p>
  );
}

function CredentialsRow({
  label, testid, type, value, onChange, placeholder,
}: {
  label: string;
  testid: string;
  type: 'text' | 'password';
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) block mb-1">
        {label}
      </span>
      <input
        type={type}
        data-testid={testid}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="sm-field-input sm-mono"
      />
    </label>
  );
}

function SaveCredsButton({
  hook, clientID, clientSecret,
}: { hook: ReturnType<typeof useGCal>; clientID: string; clientSecret: string }) {
  const report = useReportError();
  const t = useTranslations('adminIntegrations.calendar');
  const disabled = clientID.trim() === '' || clientSecret.trim() === '';
  return (
    <button
      type="button"
      disabled={disabled}
      data-testid="gcal-save-credentials"
      onClick={() => { void hook.saveCredentials(clientID, clientSecret).catch(report); }}
      className="sm-btn sm-btn-ghost sm-btn-sm"
    >
      {t('saveCredentials')}
    </button>
  );
}

// ─── connect / disconnect ─────────────────────────────────────

function ConnectButtons({ hook }: { hook: ReturnType<typeof useGCal> }) {
  return hook.status?.has_credentials === true
    ? <ConnectButtonsRow hook={hook} />
    : null;
}

function ConnectButtonsRow({ hook }: { hook: ReturnType<typeof useGCal> }) {
  return (
    <div className="flex gap-2 mb-5">
      {hook.status?.connected === true
        ? <DisconnectBtn hook={hook} />
        : <AuthorizeBtn hook={hook} />}
    </div>
  );
}

function AuthorizeBtn({ hook }: { hook: ReturnType<typeof useGCal> }) {
  const report = useReportError();
  const t = useTranslations('adminIntegrations.calendar');
  return (
    <button
      type="button"
      data-testid="gcal-authorize"
      onClick={() => { void hook.authorize().catch(report); }}
      className="sm-btn sm-btn-solid sm-btn-sm"
    >
      {t('authorize')}
    </button>
  );
}

function DisconnectBtn({ hook }: { hook: ReturnType<typeof useGCal> }) {
  const run = useAction();
  const t = useTranslations('adminIntegrations.calendar');
  return (
    <button
      type="button"
      data-testid="gcal-disconnect"
      onClick={() => { void run(() => hook.disconnect(), { success: 'Disconnected' }); }}
      className="sm-btn sm-btn-ghost sm-btn-sm"
    >
      {t('disconnect')}
    </button>
  );
}

