// CalendarBookingPolicy —— GCal 卡下半截：owner 定「什么时候可以被约」。
// working hours / min lead / buffer / timezone / weekdays，每一格改完即存。
//
// 从 `CalendarConnectorPanel` 里搬出来：那张卡上半截讲的是**连没连上**（凭据、授权、断开），
// 这半截讲的是**连上之后按什么规矩排**，两件事只是恰好画在同一张卡上。
//
// 视觉沿用卡里的语言（mono kicker + 一列字段），不另起风格。

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

// positiveIntOr —— min_lead_days 只接受正整数 (≥1)；空 / 0 / 负 / 非数回退到
// fallback。恒正保证 booking 永远落在未来，杜绝过去时段。
function positiveIntOr(v: string, fallback: number): number {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n >= 1 ? n : fallback;
}

// PolicyTimezoneRow —— 这个控件显示的**必须**是库里存着的那个值。
//
// 上一版在没存过时显示浏览器自己的时区（UX-11：躲开 option[0] 那个 "-11:00 American Samoa"）。
// 躲开是对的，但代价没人接：屏幕上写着 America/Toronto，库里是空串，而 `book.go` 把空串读成
// **UTC** —— owner 设的 09:00–18:00 在 UTC 上判，访客拿到的第一个时段是多伦多凌晨 05:18
// （F-B-5 ⭐）。一个显示着「已经配好」的控件，让人没有理由去点它。
//
// 现在：空就显示空，并且把**空的后果**写在旁边（时间按 UTC 算），顺带把检测到的时区作为
// 建议说出来 —— 那条信息本来是好的，只是它属于一句提示，不属于一个假装存过的值。
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
