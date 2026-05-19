// CodeCard —— Codes section 列表卡。
// 顶部：label + status pill；下面 scope chips + suggested questions + QR tile。

import { Btn } from '@/components/admin/atoms/Btn';
import { Chip } from '@/components/admin/atoms/Chip';
import { MetaPair } from '@/components/admin/atoms/MetaPair';
import { QRCode } from '@/components/admin/atoms/QRCode';
import { MembersBlock } from '@/components/admin/sections/codes/MembersBlock';
import { buildShareLink } from '@/lib/admin/code-share';

import type { CodeView } from '@/lib/admin/use-codes';

type Props = {
  code: CodeView;
  onEdit: (c: CodeView) => void;
  onPreview: (c: CodeView) => void;
  onShowQR: (c: CodeView) => void;
  onRevoke: (c: CodeView) => void;
};

export function CodeCard({ code, onEdit, onPreview, onShowQR, onRevoke }: Props) {
  const link = buildShareLink(code.code);
  return (
    <article className="crosshair border border-(--color-rule) bg-(--color-surface)/30 p-5 rounded-sm" data-testid={`code-card-${code.code}`}>
      <span className="ch-tl" /><span className="ch-br" />
      <CodeCardHeader code={code} onEdit={onEdit} onPreview={onPreview} onRevoke={onRevoke} />
      <div className="flex gap-5 mt-5 flex-wrap lg:flex-nowrap">
        <CodeCardBody code={code} />
        <CodeCardQR code={code} link={link} onShowQR={onShowQR} />
      </div>
      <CodeCardFooter code={code} link={link} />
    </article>
  );
}

type HeaderProps = {
  code: CodeView;
  onEdit: (c: CodeView) => void;
  onPreview: (c: CodeView) => void;
  onRevoke: (c: CodeView) => void;
};

function CodeCardHeader({ code, onEdit, onPreview, onRevoke }: HeaderProps) {
  return (
    <div className="flex items-baseline justify-between mb-2 gap-3">
      <CodeCardTitle code={code} />
      <CodeCardActions code={code} onEdit={onEdit} onPreview={onPreview} onRevoke={onRevoke} />
    </div>
  );
}

function CodeCardActions({ code, onEdit, onPreview, onRevoke }: HeaderProps) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <Btn size="sm" kind="ghost" onClick={() => onPreview(code)}>preview ↗</Btn>
      <Btn size="sm" kind="outline" onClick={() => onEdit(code)}>edit</Btn>
      <RevokeBtn code={code} onRevoke={onRevoke} />
    </div>
  );
}

function RevokeBtn({ code, onRevoke }: { code: CodeView; onRevoke: (c: CodeView) => void }) {
  return code.status === 'active' ? (
    <button
      type="button"
      data-testid={`code-revoke-${code.code}`}
      onClick={() => onRevoke(code)}
      className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-faint) hover:text-(--color-accent)"
    >
      revoke
    </button>
  ) : null;
}

function CodeCardTitle({ code }: { code: CodeView }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-3">
        <h3 className="font-serif text-(--color-ink) text-[20px] font-medium tracking-[-0.01em] truncate">
          {code.label}
        </h3>
        <StatusPill status={code.status} />
      </div>
      <div className="mono text-[11px] tracking-[0.04em] text-(--color-muted) mt-1">
        <span className="text-(--color-ink)">{code.code}</span>
        <PurposeText purpose={code.purpose} />
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const active = status === 'active';
  const cls = active ? 'text-(--color-accent)' : 'text-(--color-faint)';
  return (
    <span className={`mono text-[10px] tracking-[0.16em] uppercase ${cls}`}>
      {active ? '● active' : status}
    </span>
  );
}

function PurposeText({ purpose }: { purpose?: string }) {
  return purpose ? (
    <>
      <span className="text-(--color-faint) mx-2">·</span>
      <span>{purpose}</span>
    </>
  ) : null;
}

function CodeCardBody({ code }: { code: CodeView }) {
  return (
    <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-5">
      <ScopeBlock included={code.included_tags} excluded={code.excluded_tags} />
      <SuggestedBlock suggested={code.suggested_questions ?? []} />
      <QuotaLine code={code} />
    </div>
  );
}

function QuotaLine({ code }: { code: CodeView }) {
  const hasQuota = code.max_sessions_per_member || code.max_turns_per_session;
  return hasQuota ? (
    <div className="col-span-full mono text-[10.5px] tracking-[0.04em] text-(--color-muted)" data-testid={`code-quotas-${code.code}`}>
      quota · {quotaSummary(code.max_sessions_per_member, 'sessions/visitor')}
      <span className="mx-2 text-(--color-faint)">·</span>
      {quotaSummary(code.max_turns_per_session, 'turns/session')}
    </div>
  ) : null;
}

function quotaSummary(n: number | null | undefined, label: string): string {
  return n && n > 0 ? `${n} ${label}` : `unlimited ${label}`;
}

function ScopeBlock({
  included, excluded,
}: { included: readonly string[]; excluded: readonly string[] }) {
  return (
    <MetaPair label="access scope">
      <div className="flex flex-wrap gap-1.5">
        {included.map((t) => <Chip key={`i-${t}`}>{t}</Chip>)}
        {excluded.map((t) => <Chip key={`x-${t}`} tone="private" title="excluded">× {t}</Chip>)}
        <UnrestrictedHint shown={included.length === 0 && excluded.length === 0} />
      </div>
    </MetaPair>
  );
}

function UnrestrictedHint({ shown }: { shown: boolean }) {
  return shown
    ? <span className="mono text-[10px] text-(--color-faint)">(unrestricted)</span>
    : null;
}

function SuggestedBlock({ suggested }: { suggested: readonly string[] }) {
  return (
    <MetaPair label="suggested questions">
      <ul className="space-y-1 text-[14.5px]">
        {suggested.slice(0, 3).map((q, i) => (
          <li key={i} className="font-serif italic text-(--color-muted)">&ldquo;{q}&rdquo;</li>
        ))}
        <MoreHint count={suggested.length} />
      </ul>
    </MetaPair>
  );
}

function MoreHint({ count }: { count: number }) {
  return count > 3
    ? <li className="mono text-[10px] tracking-[0.12em] text-(--color-faint)">+ {count - 3} more</li>
    : null;
}

function CodeCardQR({
  code, link, onShowQR,
}: { code: CodeView; link: string; onShowQR: (c: CodeView) => void }) {
  return (
    <button
      type="button"
      onClick={() => onShowQR(code)}
      title={`share link · ${link}`}
      className="shrink-0 group flex flex-col items-center gap-2 p-2.5 border border-(--color-rule) rounded-sm hover:border-(--color-ink) transition-colors self-start"
    >
      <QRCode value={link} size={88} />
      <span className="mono text-[9.5px] tracking-[0.16em] uppercase text-(--color-muted) group-hover:text-(--color-ink)">
        scan / share ↗
      </span>
    </button>
  );
}

function CodeCardFooter({ code, link }: { code: CodeView; link: string }) {
  return (
    <div className="mt-5 pt-3 border-t border-(--color-rule)/60">
      <FooterTop status={code.status} link={link} />
      <MembersBlock codeID={code.id} code={code.code} />
    </div>
  );
}

function FooterTop({ status, link }: { status: string; link: string }) {
  return (
    <div className="mono text-[10px] tracking-[0.12em] text-(--color-faint) flex items-baseline justify-between gap-3 flex-wrap">
      <span>status · {status}</span>
      <span className="truncate min-w-0">{link}</span>
    </div>
  );
}
