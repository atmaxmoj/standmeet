// CalendarConnectorPanel —— owner-facing Google Calendar connector card.
// 三块：
//   1. credentials form (client_id / client_secret)
//   2. status + Authorize button + Disconnect
//   3. booking policy editor (working hours / weekdays / lead time / timezone)
//
// 设计稿没专门画 GCal 卡，沿用 ConnectorTile 视觉语言（crosshair + mono
// kicker + 字段一列）。布局窄一档（max-w-[640px]）。

'use client';

import { useState } from 'react';

import {
  useGCal, type BookingPolicy, type WeekdayT,
} from '@/lib/admin/use-gcal';

const ALL_WEEKDAYS: readonly WeekdayT[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

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
  return (
    <div className="flex items-baseline justify-between mb-4">
      <h3 className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted)">
        Google Calendar
      </h3>
      <StatusBadge status={status} />
    </div>
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
  return (
    <p className="reading-tight text-[12.5px] text-(--color-muted) italic">
      Google Cloud console → APIs &amp; Services → Credentials → OAuth client
      ID (Desktop). Owner&apos;s own client; no global StandMeet OAuth.
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
        className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 mono text-[13px]"
      />
    </label>
  );
}

function SaveCredsButton({
  hook, clientID, clientSecret,
}: { hook: ReturnType<typeof useGCal>; clientID: string; clientSecret: string }) {
  const disabled = clientID.trim() === '' || clientSecret.trim() === '';
  return (
    <button
      type="button"
      disabled={disabled}
      data-testid="gcal-save-credentials"
      onClick={() => { void hook.saveCredentials(clientID, clientSecret); }}
      className="sm-btn sm-btn-ghost sm-btn-sm"
    >
      Save credentials
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
  return (
    <button
      type="button"
      data-testid="gcal-authorize"
      onClick={() => { void hook.authorize(); }}
      className="sm-btn sm-btn-solid sm-btn-sm"
    >
      Authorize on Google →
    </button>
  );
}

function DisconnectBtn({ hook }: { hook: ReturnType<typeof useGCal> }) {
  return (
    <button
      type="button"
      data-testid="gcal-disconnect"
      onClick={() => { void hook.disconnect(); }}
      className="sm-btn sm-btn-ghost sm-btn-sm"
    >
      Disconnect (keeps credentials)
    </button>
  );
}

// ─── booking policy ───────────────────────────────────────────

function PolicyEditor({ hook }: { hook: ReturnType<typeof useGCal> }) {
  const p = hook.policy;
  return p === null ? null : <PolicyEditorBody policy={p} hook={hook} />;
}

function PolicyEditorBody({
  policy, hook,
}: { policy: BookingPolicy; hook: ReturnType<typeof useGCal> }) {
  return (
    <div className="border-t border-(--color-rule)/60 pt-4 mt-2 space-y-3">
      <h4 className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted)">
        Booking policy
      </h4>
      <PolicyHoursRow policy={policy} hook={hook} />
      <PolicyLeadBufferRow policy={policy} hook={hook} />
      <PolicyTimezoneRow policy={policy} hook={hook} />
      <PolicyWeekdaysRow policy={policy} hook={hook} />
    </div>
  );
}

function PolicyHoursRow({
  policy, hook,
}: { policy: BookingPolicy; hook: ReturnType<typeof useGCal> }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <PolicyInput
        label="working hours start (HH:MM)"
        testid="gcal-hours-start"
        value={policy.working_hours_start}
        onBlur={(v) => { void hook.savePolicy({ working_hours_start: v }); }}
      />
      <PolicyInput
        label="working hours end (HH:MM)"
        testid="gcal-hours-end"
        value={policy.working_hours_end}
        onBlur={(v) => { void hook.savePolicy({ working_hours_end: v }); }}
      />
    </div>
  );
}

function PolicyLeadBufferRow({
  policy, hook,
}: { policy: BookingPolicy; hook: ReturnType<typeof useGCal> }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <PolicyInput
        label="min lead hours"
        testid="gcal-lead-hours"
        value={String(policy.min_lead_hours)}
        onBlur={(v) => { void hook.savePolicy({ min_lead_hours: parseInt(v, 10) || 0 }); }}
      />
      <PolicyInput
        label="buffer min (around existing events)"
        testid="gcal-buffer-min"
        value={String(policy.buffer_min)}
        onBlur={(v) => { void hook.savePolicy({ buffer_min: parseInt(v, 10) || 0 }); }}
      />
    </div>
  );
}

function PolicyTimezoneRow({
  policy, hook,
}: { policy: BookingPolicy; hook: ReturnType<typeof useGCal> }) {
  return (
    <PolicyInput
      label="timezone (IANA)"
      testid="gcal-timezone"
      value={policy.timezone}
      placeholder="America/New_York"
      onBlur={(v) => { void hook.savePolicy({ timezone: v }); }}
    />
  );
}

function PolicyInput({
  label, testid, value, placeholder, onBlur,
}: {
  label: string;
  testid: string;
  value: string;
  placeholder?: string;
  onBlur: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);
  return (
    <label className="block">
      <span className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) block mb-1">
        {label}
      </span>
      <input
        type="text"
        data-testid={testid}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => { local !== value && onBlur(local); }}
        placeholder={placeholder}
        className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 mono text-[13px]"
      />
    </label>
  );
}

function PolicyWeekdaysRow({
  policy, hook,
}: { policy: BookingPolicy; hook: ReturnType<typeof useGCal> }) {
  return (
    <div>
      <span className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) block mb-2">
        allowed weekdays
      </span>
      <div className="flex flex-wrap gap-1.5" data-testid="gcal-weekdays-picker">
        {ALL_WEEKDAYS.map((d) => (
          <WeekdayToggle
            key={d}
            day={d}
            selected={policy.allowed_weekdays.includes(d)}
            onToggle={() => {
              const next = policy.allowed_weekdays.includes(d)
                ? policy.allowed_weekdays.filter((x) => x !== d)
                : [...policy.allowed_weekdays, d];
              void hook.savePolicy({ allowed_weekdays: next });
            }}
          />
        ))}
      </div>
    </div>
  );
}

function WeekdayToggle({
  day, selected, onToggle,
}: { day: WeekdayT; selected: boolean; onToggle: () => void }) {
  const cls = selected
    ? 'border-(--color-accent) text-(--color-accent)'
    : 'border-(--color-rule) text-(--color-muted) hover:border-(--color-ink)';
  return (
    <button
      type="button"
      data-testid={`gcal-weekday-${day}`}
      onClick={onToggle}
      className={`mono text-[11px] tracking-[0.10em] uppercase px-2 py-1 border ${cls} rounded-sm bg-transparent`}
    >
      {day}
    </button>
  );
}
