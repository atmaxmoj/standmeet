// RawRowList —— Raw section 列表。空时显示 "no raw entries yet" 提示。
// row 自带 promote / archive 占位按钮（backend 暂未暴露 mutation 端点）。

import { Btn } from '@/components/admin/atoms/Btn';
import { Chip } from '@/components/admin/atoms/Chip';

import type { RawAdminView } from '@/lib/api/admin';

type Props = { rows: readonly RawAdminView[] };

export function RawRowList({ rows }: Props) {
  return rows.length === 0
    ? <EmptyState />
    : (
      <ul data-testid="raw-list" className="border-t border-(--color-rule)/70">
        {rows.map((r) => <RawRow key={r.id} row={r} />)}
      </ul>
    );
}

function EmptyState() {
  return (
    <ul data-testid="raw-list" className="border-t border-(--color-rule)/70">
      <li className="py-8 reading italic text-(--color-muted) text-center">
        No raw entries yet. Push one from an MCP client (raw_dump tool).
      </li>
    </ul>
  );
}

function RawRow({ row }: { row: RawAdminView }) {
  return (
    <li className="grid grid-cols-[80px_1fr_auto] gap-6 py-5 border-b border-(--color-rule)/70">
      <RawRowMeta source={row.source} createdAt={row.created_at} />
      <RawRowBody body={row.body} tags={row.tags} privateFlag={row.flagged_private} />
      <RawRowActions />
    </li>
  );
}

function RawRowMeta({ source, createdAt }: { source: string; createdAt: string }) {
  return (
    <div className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) pt-1 leading-[1.5]">
      <div className="text-(--color-ink)">{source}</div>
      <div className="text-(--color-faint) mt-0.5 normal-case tracking-[0.04em]">{createdAt}</div>
    </div>
  );
}

function RawRowBody({
  body, tags, privateFlag,
}: { body: string; tags: readonly string[]; privateFlag: boolean }) {
  return (
    <div className="min-w-0">
      <p className="reading-tight text-(--color-ink) text-[15.5px]">{body}</p>
      <div className="mt-3 flex flex-wrap items-baseline gap-1.5">
        {tags.map((t) => <Chip key={t}>{t}</Chip>)}
        <PrivateBadge on={privateFlag} />
      </div>
    </div>
  );
}

function PrivateBadge({ on }: { on: boolean }) {
  return on
    ? <span className="mono text-[10px] tracking-[0.14em] uppercase ml-1 text-(--color-accent)">· flagged private</span>
    : null;
}

function RawRowActions() {
  return (
    <div className="flex flex-col items-end gap-1.5 shrink-0">
      <Btn size="sm" kind="outline">promote ↗</Btn>
      <Btn size="sm" kind="ghost">archive</Btn>
    </div>
  );
}
