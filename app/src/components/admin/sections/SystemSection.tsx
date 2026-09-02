// SystemSection —— /admin/system. #101 wires up the real system-info backend: deployment
// (version/uptime), resources (host disk/mem/load + go runtime), and health checks all go
// through real values + a real ping from GET /api/admin/system.
// The background jobs table hits the real GET /api/admin/stats/jobs (Monitor): only lists cron
// jobs actually running.

'use client';

import { useTranslations } from 'next-intl';

import { AdminSectionHead } from '@/components/admin/AdminSectionHead';
import { SectionHeader } from '@/components/admin/SectionHeader';
import { InferenceUsagePanel } from '@/components/admin/sections/system/InferenceUsagePanel';
import { SandboxPanel } from '@/components/admin/sections/system/SandboxPanel';
import { UpgradePanel } from '@/components/admin/sections/system/UpgradePanel';
import { useScheduledJobs, jobRowViews } from '@/lib/admin/use-jobs';
import {
  useSystemInfo, deployView, healthList, resourceStats, type SystemInfo,
} from '@/lib/admin/use-system-info';

export function SystemSection() {
  const { info } = useSystemInfo();
  return (
    <>
      {/* The button that was in the top bar moved into UpgradePanel — it originally had no
          onClick, wasn't wired to anything, and there also needs to be room next to it to say
          the outcome (did the upgrade happen or not), which the top bar's slot couldn't fit. */}
      <SectionHeader kicker="settings · runtime" slug="system" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <UpgradePanel />
        <DeploymentBlock info={info} />
        <ResourcesBlock info={info} />
        <JobsTable />
        <HealthChecks info={info} />
        <InferenceUsagePanel />
        <SandboxPanel />
      </div>
    </>
  );
}

function DeploymentBlock({ info }: { info: SystemInfo | null }) {
  const t = useTranslations('adminShell.system');
  const d = deployView(info);
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50" data-testid="system-terminal">
      <AdminSectionHead className="mb-3">{t('deployment')}</AdminSectionHead>
      <div className="border border-(--color-rule) rounded-[3px] p-3 bg-[color-mix(in_oklab,var(--color-ink)_6%,var(--color-paper))] mono text-[11.5px] leading-[1.7] text-(--color-muted)">
        <div><span className="text-(--color-accent)">$</span> {t('statusCmd')}</div>
        <div><span className="text-(--color-faint)">{t('treeBranch')}</span> {t('version')} <span className="text-(--color-ink)" data-testid="system-version">{d.version}</span></div>
        <div><span className="text-(--color-faint)">{t('treeBranch')}</span> {t('cpus')} <span className="text-(--color-ink)">{d.cpus}</span></div>
        <div><span className="text-(--color-faint)">{t('treeBranch')}</span> {t('uptime')} <span className="text-(--color-ink)" data-testid="system-uptime">{d.uptime}</span></div>
        <div><span className="text-(--color-faint)">{t('treeLast')}</span> {t('migrations')} <span className="text-(--color-ink)">{t('migrationsPending')}</span></div>
        <div className="mt-2"><span className="text-(--color-accent)">$</span> {t('ready')}<span className="animate-pulse">_</span></div>
      </div>
    </div>
  );
}

function ResourcesBlock({ info }: { info: SystemInfo | null }) {
  const t = useTranslations('adminShell.system');
  const stats = resourceStats(info);
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50" data-testid="system-resources">
      <AdminSectionHead className="mb-3">{t('resources')}</AdminSectionHead>
      <div className="grid grid-cols-2 gap-3">
        {stats.map((s) => (
          <ResourceStat key={s.label} label={s.label} value={s.value} sub={s.sub} />
        ))}
      </div>
    </div>
  );
}

function ResourceStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-3 bg-(--color-surface)/30">
      <div className="sm-smallcaps mb-1">{label}</div>
      <div className="font-serif text-(--color-ink) text-[28px] tabular-nums leading-none">{value}</div>
      <div className="mono text-[10px] text-(--color-muted) tracking-[0.06em] mt-1">{sub}</div>
    </div>
  );
}

function JobsTable() {
  const t = useTranslations('adminShell.system');
  const { jobs } = useScheduledJobs();
  const rows = jobRowViews(jobs);
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50 lg:col-span-2" data-testid="system-jobs">
      <AdminSectionHead className="mb-3">{t('backgroundJobs')}</AdminSectionHead>
      <table className="w-full border-collapse">
        <thead>
          <tr className="mono text-[9.5px] tracking-[0.2em] uppercase text-(--color-muted)">
            <th className="text-left px-1.5 py-2 border-b border-(--color-rule) font-normal">{t('colJob')}</th>
            <th className="text-left px-1.5 py-2 border-b border-(--color-rule) font-normal">{t('colSchedule')}</th>
            <th className="text-left px-1.5 py-2 border-b border-(--color-rule) font-normal">{t('colLast')}</th>
            <th className="text-left px-1.5 py-2 border-b border-(--color-rule) font-normal">{t('colStatus')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((j) => (
            <JobRow key={j.name} name={j.name} schedule={j.schedule} last={j.last} status={j.status} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JobRow({ name, schedule, last, status }: { name: string; schedule: string; last: string; status: string }) {
  const t = useTranslations('adminShell.system');
  const tone = status === 'ok' ? 'text-(--color-accent)' : 'text-(--color-amber)';
  return (
    <tr className="hover:bg-(--color-surface)/30">
      <td className="px-1.5 py-2.5 border-b border-(--color-rule)/60 font-serif text-[15px]">{name}</td>
      <td className="px-1.5 py-2.5 border-b border-(--color-rule)/60 mono text-[11.5px] tabular-nums text-(--color-muted)">{schedule}</td>
      <td className="px-1.5 py-2.5 border-b border-(--color-rule)/60 mono text-[11.5px] tabular-nums text-(--color-muted)">{last}</td>
      <td className={`px-1.5 py-2.5 border-b border-(--color-rule)/60 mono text-[10px] tracking-[0.14em] uppercase ${tone}`}>{t('statusDot')} {status}</td>
    </tr>
  );
}

function HealthChecks({ info }: { info: SystemInfo | null }) {
  const t = useTranslations('adminShell.system');
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50 lg:col-span-2" data-testid="system-health">
      <AdminSectionHead className="mb-3">{t('healthChecks')}</AdminSectionHead>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {healthList(info).map((c) => (
          <HealthRow key={c.name} name={c.name} status={c.ok ? 'ok' : 'down'} detail={c.detail} />
        ))}
      </div>
    </div>
  );
}

function healthTone(status: string): { dot: string; text: string } {
  return status === 'ok'
    ? { dot: 'bg-(--color-accent)', text: 'text-(--color-accent)' }
    : { dot: 'bg-(--color-amber)', text: 'text-(--color-amber)' };
}

function HealthRow({ name, status, detail }: { name: string; status: string; detail: string }) {
  const tone = healthTone(status);
  return (
    // health-row-<name> —— the whole row for one dependency (name + description + status). Name
    // and description are two separate divs, so searching by innerText line only gets the name;
    // what the guard needs to check is exactly **the sentence in the description** (F-S-3).
    <div data-testid={`health-row-${name}`}
      className="flex items-baseline gap-3 pb-2 border-b border-(--color-rule)/60">
      <span data-testid="health-dot" className={`inline-block w-[6px] h-[6px] rounded-full ${tone.dot} shrink-0 relative top-[1px]`} />
      <div className="flex-1">
        <div className="font-serif text-[15px] text-(--color-ink)">{name}</div>
        <div className="mono text-[10px] text-(--color-muted) mt-0.5">{detail}</div>
      </div>
      <span className={`mono text-[10px] tracking-[0.14em] uppercase ${tone.text}`}>{status}</span>
    </div>
  );
}
