// CalendarBookingPolicy — bottom half of the GCal card: owner sets "when can I be booked".
// working hours / min lead / buffer / timezone / weekdays, each field saves on change.
//
// Split out of `CalendarConnectorPanel`: that card's top half is about **whether it's
// connected** (credentials, authorize, disconnect); this half is about **what rules apply
// once it's connected** — two different things that just happen to share one card.
//
// Visually it keeps the card's language (mono kicker + a column of fields), no new style.

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import {
  toggledWeekdays, type useGCal, type BookingPolicy, type WeekdayT,
} from '@/lib/admin/use-gcal';
import { SelectField } from '@/components/atoms/SelectField';
import { timezoneOptions, detectedTimezone } from '@/lib/admin/timezones';
import { useReportError } from '@/lib/ui/use-report-error';

const ALL_WEEKDAYS: readonly WeekdayT[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export function PolicyEditor({ hook }: { hook: ReturnType<typeof useGCal> }) {
  const p = hook.policy;
  return p === null ? null : <PolicyEditorBody policy={p} hook={hook} />;
}

function PolicyEditorBody({
  policy, hook,
}: { policy: BookingPolicy; hook: ReturnType<typeof useGCal> }) {
  const t = useTranslations('adminIntegrations.calendar');
  return (
    <div className="border-t border-(--color-rule)/60 pt-4 mt-2 space-y-3">
      <h4 className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted)">
        {t('policyHeading')}
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
  const report = useReportError();
  return (
    <div className="grid grid-cols-2 gap-3">
      <PolicyInput
        label="working hours start (HH:MM)"
        testid="gcal-hours-start"
        value={policy.working_hours_start}
        onBlur={(v) => { void hook.savePolicy({ working_hours_start: v }).catch(report); }}
      />
      <PolicyInput
        label="working hours end (HH:MM)"
        testid="gcal-hours-end"
        value={policy.working_hours_end}
        onBlur={(v) => { void hook.savePolicy({ working_hours_end: v }).catch(report); }}
      />
    </div>
  );
}

function PolicyLeadBufferRow({
  policy, hook,
}: { policy: BookingPolicy; hook: ReturnType<typeof useGCal> }) {
  const report = useReportError();
  return (
    <div className="grid grid-cols-2 gap-3">
      <PolicyInput
        label="min days in advance"
        testid="gcal-lead-days"
        value={String(policy.min_lead_days)}
        onBlur={(v) => { void hook.savePolicy({ min_lead_days: positiveIntOr(v, 2) }).catch(report); }}
      />
      <PolicyInput
        label="buffer min (around existing events)"
        testid="gcal-buffer-min"
        value={String(policy.buffer_min)}
        onBlur={(v) => { void hook.savePolicy({ buffer_min: parseInt(v, 10) || 0 }).catch(report); }}
      />
    </div>
  );
}

// positiveIntOr — min_lead_days only accepts a positive integer (>=1); empty / 0 / negative /
// non-numeric falls back to `fallback`. Staying positive keeps bookings in the future and
// rules out past slots.
function positiveIntOr(v: string, fallback: number): number {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n >= 1 ? n : fallback;
}

// PolicyTimezoneRow — this control **must** display the value actually stored in the DB.
//
// The previous version showed the browser's own timezone when nothing was stored (UX-11:
// dodging option[0]'s "-11:00 American Samoa"). Dodging that was right, but nobody caught the
// cost: the screen read America/Toronto while the DB held an empty string, and `book.go` reads
// an empty string as **UTC** — the owner's 09:00-18:00 gets judged in UTC, and a visitor's
// first offered slot lands at 05:18 Toronto time (F-B-5 star). A control that displays
// "already configured" gives nobody a reason to click it.
//
// Now: empty shows as empty, with the **consequence of empty** written right next to it
// (times are computed in UTC), and the detected timezone is offered as a suggestion on the
// side — that information was good all along, it just belongs in a hint, not in a value
// pretending to have been saved.
function PolicyTimezoneRow({
  policy, hook,
}: { policy: BookingPolicy; hook: ReturnType<typeof useGCal> }) {
  const report = useReportError();
  const t = useTranslations('adminIntegrations.calendar');
  return (
    <div>
      <label className="block">
        <span className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) block mb-1">
          {t('timezone')}
        </span>
        <SelectField
          testid="gcal-timezone"
          value={policy.timezone}
          onChange={(e) => { void hook.savePolicy({ timezone: e.target.value }).catch(report); }}
          className="w-full"
          mono
        >
          {policy.timezone === '' && <option value="">{t('timezoneUnsetOption')}</option>}
          {timezoneOptions(policy.timezone).map((tz) => (
            <option key={tz.value} value={tz.value}>{tz.label}</option>
          ))}
        </SelectField>
      </label>
      {policy.timezone === '' && <TimezoneUnsetHint />}
    </div>
  );
}

function TimezoneUnsetHint() {
  const t = useTranslations('adminIntegrations.calendar');
  return (
    <p
      className="mono text-[10.5px] leading-[1.7] text-(--color-muted) mt-1.5"
      data-testid="gcal-timezone-unset"
    >
      {t('timezoneUnsetHint', { detected: detectedTimezone() })}
    </p>
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
        className="sm-field-input sm-mono"
      />
    </label>
  );
}

function PolicyWeekdaysRow({
  policy, hook,
}: { policy: BookingPolicy; hook: ReturnType<typeof useGCal> }) {
  const report = useReportError();
  const t = useTranslations('adminIntegrations.calendar');
  return (
    <div>
      <span className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) block mb-2">
        {t('weekdays')}
      </span>
      <div className="flex flex-wrap gap-1.5" data-testid="gcal-weekdays-picker">
        {ALL_WEEKDAYS.map((d) => (
          <WeekdayToggle
            key={d}
            day={d}
            selected={policy.allowed_weekdays.includes(d)}
            onToggle={() => {
              const next = toggledWeekdays(policy.allowed_weekdays, d);
              void hook.savePolicy({ allowed_weekdays: next }).catch(report);
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
