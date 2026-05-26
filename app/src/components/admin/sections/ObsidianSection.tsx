// ObsidianSection —— /admin/obsidian。design 源 admin.js ObsidianSection
// (2283-2330)。vault path + mode + notes + size + queue + recent events。
// 当前后端 obsidian sync 走 import/export zip（memory: obsidian-sync-design）
// —— "connected" state 是 dummy；真 live sync 不做（per design decision）。
// 这里渲 design 视觉 + 链到 import/export 动作。

'use client';

import { SectionHeader } from '@/components/admin/SectionHeader';

export function ObsidianSection() {
  return (
    <>
      <SectionHeader
        kicker="integrations · vault"
        title="obsidian"
        action={
          <span className="mono text-[10.5px] tracking-[0.16em] uppercase text-(--color-faint)">
            ○ manual mode
          </span>
        }
      />
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-5">
        <VaultCard />
        <ActionsCard />
      </div>
    </>
  );
}

function VaultCard() {
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50">
      <div className="sm-smallcaps mb-3">vault</div>
      <div className="mono text-[13px] text-(--color-ink) tracking-[0.02em]">
        ~/vaults/standmeet-mirror
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
        <StatCell label="mode" value="manual" />
        <StatCell label="notes" value="—" />
        <StatCell label="size · mb" value="—" />
        <StatCell label="last sync" value="—" />
      </div>
      <div className="mt-5">
        <div className="sm-smallcaps mb-2">actions</div>
        <div className="flex gap-2">
          <button className="sm-btn sm-btn-solid sm-btn-sm" type="button">import vault zip</button>
          <button className="sm-btn sm-btn-outline sm-btn-sm" type="button">export corpus zip</button>
        </div>
        <p className="mono text-[10px] text-(--color-faint) tracking-[0.06em] mt-2 max-w-[36em]">
          import reads an Obsidian vault zip + upserts matching wiki entries by frontmatter slug.
          export downloads your corpus as a zip of markdown files with YAML frontmatter.
          No live sync / file watcher — two buttons, that&apos;s it.
        </p>
      </div>
    </div>
  );
}

function ActionsCard() {
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50">
      <div className="sm-smallcaps mb-3">recent events</div>
      <p className="mono text-[11px] text-(--color-faint) tracking-[0.06em]">
        no sync events yet — run an import or export to populate this log.
      </p>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-3 bg-(--color-surface)/30">
      <div className="sm-smallcaps mb-1">{label}</div>
      <div className="font-serif text-(--color-ink) text-[20px] tabular-nums leading-none">{value}</div>
    </div>
  );
}
