// SystemSection —— /admin/system。design 源 admin.js SystemSection
// (2502-2560)。terminal-y deployment block + resources KPIs + background
// jobs table + health checks grid。
// 当前没有 admin REST for system info —— 用 placeholder values。

'use client';

import { SectionHeader } from '@/components/admin/SectionHeader';

export function SystemSection() {
  return (
    <>
      <SectionHeader
        kicker="settings · runtime"
        title="system"
        action={<button className="sm-btn sm-btn-outline sm-btn-sm" type="button">check for updates</button>}
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <DeploymentBlock />
        <ResourcesBlock />
        <JobsTable />
        <HealthChecks />
      </div>
    </>
  );
}

function DeploymentBlock() {
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50" data-testid="system-terminal">
      <div className="sm-smallcaps mb-3">deployment</div>
      <div className="border border-(--color-rule) rounded-[3px] p-3 bg-[color-mix(in_oklab,var(--color-ink)_6%,var(--color-paper))] mono text-[11.5px] leading-[1.7] text-(--color-muted)">
        <div><span className="text-(--color-accent)">$</span> standmeet status</div>
        <div><span className="text-(--color-faint)">├─</span> version <span className="text-(--color-ink)">—</span></div>
        <div><span className="text-(--color-faint)">├─</span> node <span className="text-(--color-ink)">—</span></div>
        <div><span className="text-(--color-faint)">├─</span> uptime <span className="text-(--color-ink)">—</span></div>
        <div><span className="text-(--color-faint)">└─</span> migrations <span className="text-(--color-ink)">0 pending</span></div>
        <div className="mt-2"><span className="text-(--color-accent)">$</span> ready<span className="animate-pulse">_</span></div>
      </div>
    </div>
  );
}

function ResourcesBlock() {
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50">
      <div className="sm-smallcaps mb-3">resources</div>
      <div className="grid grid-cols-2 gap-3">
        <ResourceStat label="cpu load" value="—" sub="1m avg" />
        <ResourceStat label="memory" value="—" sub="/ — mb" />
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
          <JobRow name="sitemap regenerate" schedule="every 6h" last="—" status="ok" />
          <JobRow name="corpus reindex" schedule="on change" last="—" status="ok" />
          <JobRow name="daily backup" schedule="02:00" last="—" status="ok" />
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

function HealthChecks() {
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50 lg:col-span-2" data-testid="system-health">
      <div className="sm-smallcaps mb-3">health checks</div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <HealthRow name="database" status="ok" detail="postgres · WAL mode" />
        <HealthRow name="redis" status="ok" detail="job cache + sessions" />
        <HealthRow name="minio" status="ok" detail="asset blob storage" />
        <HealthRow name="mcp endpoint" status="ok" detail="listening" />
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
