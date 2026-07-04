// SystemSection —— /admin/system。#101 接真 system-info 后端:deployment(version/uptime)、
// resources(主机 disk/mem/load + go runtime)、health checks 都走 GET /api/admin/system 真值 + 真 ping。
// background jobs 表接真 GET /api/admin/stats/jobs(Monitor):只列真正在跑的 cron。

'use client';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { InferenceUsagePanel } from '@/components/admin/sections/system/InferenceUsagePanel';
import { SandboxPanel } from '@/components/admin/sections/system/SandboxPanel';
import { useScheduledJobs, jobRowViews } from '@/lib/admin/use-jobs';
import {
  useSystemInfo, deployView, healthList, resourceStats, type SystemInfo,
} from '@/lib/admin/use-system-info';

export function SystemSection() {
  const { info } = useSystemInfo();
  return (
    <>
      <SectionHeader
        kicker="settings · runtime"
        title="system"
        action={<button className="sm-btn sm-btn-outline sm-btn-sm" type="button">check for updates</button>}
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
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
  const d = deployView(info);
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50" data-testid="system-terminal">
      <div className="sm-smallcaps mb-3">deployment</div>
      <div className="border border-(--color-rule) rounded-[3px] p-3 bg-[color-mix(in_oklab,var(--color-ink)_6%,var(--color-paper))] mono text-[11.5px] leading-[1.7] text-(--color-muted)">
        <div><span className="text-(--color-accent)">$</span> standmeet status</div>
        <div><span className="text-(--color-faint)">├─</span> version <span className="text-(--color-ink)" data-testid="system-version">{d.version}</span></div>
        <div><span className="text-(--color-faint)">├─</span> cpus <span className="text-(--color-ink)">{d.cpus}</span></div>
        <div><span className="text-(--color-faint)">├─</span> uptime <span className="text-(--color-ink)" data-testid="system-uptime">{d.uptime}</span></div>
        <div><span className="text-(--color-faint)">└─</span> migrations <span className="text-(--color-ink)">0 pending</span></div>
        <div className="mt-2"><span className="text-(--color-accent)">$</span> ready<span className="animate-pulse">_</span></div>
      </div>
    </div>
  );
}

function ResourcesBlock({ info }: { info: SystemInfo | null }) {
  const stats = resourceStats(info);
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50" data-testid="system-resources">
      <div className="sm-smallcaps mb-3">resources · host + runtime</div>
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
  const { jobs } = useScheduledJobs();
  const rows = jobRowViews(jobs);
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50 lg:col-span-2" data-testid="system-jobs">
      <div className="sm-smallcaps mb-3">background jobs</div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="mono text-[9.5px] tracking-[0.2em] uppercase text-(--color-muted)">
            <th className="text-left px-1.5 py-2 border-b border-(--color-rule) font-normal">job</th>
            <th className="text-left px-1.5 py-2 border-b border-(--color-rule) font-normal">schedule</th>
            <th className="text-left px-1.5 py-2 border-b border-(--color-rule) font-normal">last</th>
            <th className="text-left px-1.5 py-2 border-b border-(--color-rule) font-normal">status</th>
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
  const tone = status === 'ok' ? 'text-(--color-accent)' : 'text-(--color-amber)';
  return (
    <tr className="hover:bg-(--color-surface)/30">
      <td className="px-1.5 py-2.5 border-b border-(--color-rule)/60 font-serif text-[15px]">{name}</td>
      <td className="px-1.5 py-2.5 border-b border-(--color-rule)/60 mono text-[11.5px] tabular-nums text-(--color-muted)">{schedule}</td>
      <td className="px-1.5 py-2.5 border-b border-(--color-rule)/60 mono text-[11.5px] tabular-nums text-(--color-muted)">{last}</td>
      <td className={`px-1.5 py-2.5 border-b border-(--color-rule)/60 mono text-[10px] tracking-[0.14em] uppercase ${tone}`}>● {status}</td>
    </tr>
  );
}

function HealthChecks({ info }: { info: SystemInfo | null }) {
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50 lg:col-span-2" data-testid="system-health">
      <div className="sm-smallcaps mb-3">health checks</div>
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
    <div className="flex items-baseline gap-3 pb-2 border-b border-(--color-rule)/60">
      <span data-testid="health-dot" className={`inline-block w-[6px] h-[6px] rounded-full ${tone.dot} shrink-0 relative top-[1px]`} />
      <div className="flex-1">
        <div className="font-serif text-[15px] text-(--color-ink)">{name}</div>
        <div className="mono text-[10px] text-(--color-muted) mt-0.5">{detail}</div>
      </div>
      <span className={`mono text-[10px] tracking-[0.14em] uppercase ${tone.text}`}>{status}</span>
    </div>
  );
}
