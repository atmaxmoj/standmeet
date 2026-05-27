// CodeCard —— Codes section 列表卡。
// 顶部：label + status pill；下面 scope chips + suggested questions + QR tile。

import Link from 'next/link';

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

export function CodeCard({ code, onEdit, onPreview, onShowQR: _onShowQR, onRevoke }: Props) {
  const link = buildShareLink(code.code);
  return (
    <article className="crosshair border border-(--color-rule) bg-(--color-surface)/30 p-5 rounded-sm" data-testid={`code-card-${code.code}`}>
      <span className="ch-tl" /><span className="ch-br" />
      <CodeCardHeader code={code} onEdit={onEdit} onPreview={onPreview} onRevoke={onRevoke} />
      <div className="mt-5">
        <CodeCardBody code={code} />
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
    <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-3 gap-5">
      <MembersCol codeID={code.id} code={code.code} />
      <ScopeBlock perms={code.corpus_permissions} />
      <QRCol code={code} />
      <QuotaBar code={code} />
    </div>
  );
}

function MembersCol({ codeID, code }: { codeID: string; code: string }) {
  return (
    <MetaPair label="members">
      <MembersBlock codeID={codeID} code={code} />
    </MetaPair>
  );
}

function QRCol({ code }: { code: CodeView }) {
  const link = buildShareLink(code.code);
  return (
    <MetaPair label="QR">
      <QRCode value={link} size={72} />
    </MetaPair>
  );
}

function QuotaBar({ code }: { code: CodeView }) {
  const sessions = quotaSummary(code.max_sessions_per_member, 'sessions');
  const turns = quotaSummary(code.max_turns_per_session, 'turns');
  return (
    <div className="col-span-full" data-testid={`code-quotas-${code.code}`}>
      <div className="mono text-[10px] tracking-[0.12em] uppercase text-(--color-muted) mb-1.5">quota</div>
      <div className="flex items-center gap-3">
        <div className="flex-1 h-[4px] bg-(--color-rule) rounded-full overflow-hidden">
          <div className="h-full bg-(--color-ink) rounded-full w-0" />
        </div>
        <span className="mono text-[10px] tracking-[0.04em] text-(--color-muted) shrink-0">
          {sessions} · {turns}
        </span>
      </div>
    </div>
  );
}

function quotaSummary(n: number | null | undefined, label: string): string {
  return n && n > 0 ? `${n} ${label}` : `unlimited ${label}`;
}

interface PathPerm { action: 'allow' | 'deny'; path_pattern: string }

function ScopeBlock({ perms }: { perms: readonly PathPerm[] }) {
  return (
    <MetaPair label="access scope">
      <div className="flex flex-wrap gap-1.5">
        {perms.map((p, i) => (
          <Chip key={`p-${i}`} tone={p.action === 'allow' ? undefined : 'private'}>
            {p.action === 'allow' ? '+' : '−'} {p.path_pattern}
          </Chip>
        ))}
        <UnrestrictedHint shown={perms.length === 0} />
      </div>
    </MetaPair>
  );
}

function UnrestrictedHint({ shown }: { shown: boolean }) {
  return shown
    ? <span className="mono text-[10px] text-(--color-faint)">(unrestricted)</span>
    : null;
}




function CodeCardFooter({ code, link }: { code: CodeView; link: string }) {
  return (
    <div className="mt-5 pt-3 border-t border-(--color-rule)/60">
      <FooterTop status={code.status} link={link} />
      <ConversationsLink code={code.code} />
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

function ConversationsLink({ code }: { code: string }) {
  return (
    <Link
      href={`/admin/conversations?code=${encodeURIComponent(code)}`}
      className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-accent) mt-3 inline-block"
    >
      view conversations →
    </Link>
  );
}
