// CodeCard —— Codes section 列表卡。
// 顶部：label + status pill；下面 scope chips + suggested questions + QR tile。

import { CodeCorpusConfig } from '@/components/admin/sections/codes/CodeCorpusConfig';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { Btn } from '@/components/admin/atoms/Btn';
import { MetaPair } from '@/components/admin/atoms/MetaPair';
import { QRCode } from '@/components/admin/atoms/QRCode';
import { MembersBlock } from '@/components/admin/sections/codes/MembersBlock';
import { buildShareLink } from '@/lib/admin/code-share';
import { ghostFromSelect, ghostToSelect } from '@/lib/admin/code-ghost';
import { usePrompts, type PromptView } from '@/lib/admin/use-prompts';
import { useRoles } from '@/lib/admin/use-roles';
import { useAction } from '@/lib/ui/use-action';

import { useCodes, type CodeView } from '@/lib/admin/use-codes';

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
      <CodeCorpusConfig codeID={code.id} codeLabel={code.code} />
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
  const t = useTranslations('adminAccess');
  return (
    <div className="flex items-center gap-2 shrink-0">
      <Btn size="sm" kind="ghost" onClick={() => onPreview(code)}>{t('codeCard.preview')}</Btn>
      <Btn size="sm" kind="outline" onClick={() => onEdit(code)}>{t('codeCard.edit')}</Btn>
      <RevokeBtn code={code} onRevoke={onRevoke} />
    </div>
  );
}

function RevokeBtn({ code, onRevoke }: { code: CodeView; onRevoke: (c: CodeView) => void }) {
  const t = useTranslations('adminAccess');
  return code.status === 'active' ? (
    <button
      type="button"
      data-testid={`code-revoke-${code.code}`}
      onClick={() => onRevoke(code)}
      className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-faint) hover:text-(--color-accent)"
    >
      {t('codeCard.revoke')}
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
      <RoleCol code={code} />
      <PromptCol code={code} />
      <GhostEvidenceCol code={code} />
      <QRCol code={code} />
      <QuotaBar code={code} />
    </div>
  );
}

// GhostEvidenceCol —— F-A-10 per-code 覆盖 ghost-evidence 规则。3 态:inherit(继承 role,null) /
// require(强制带证据,true) / allow(全放行,false)。code 优先于 role。存 → PATCH /ghost-evidence。
function GhostEvidenceCol({ code }: { code: CodeView }) {
  const t = useTranslations('adminAccess');
  const { setGhostEvidence } = useCodes();
  const run = useAction();
  const onPick = (v: string) => run(
    () => setGhostEvidence(code.id, ghostFromSelect(v)),
    { success: `Ghost rule updated for ${code.code}` },
  );
  return (
    <MetaPair label={t('codeGhost.label')}>
      <select
        className="mono text-[11px] bg-(--color-paper) border border-(--color-rule) px-2 py-1 min-w-0 max-w-full"
        value={ghostToSelect(code.require_ghost_evidence)}
        onChange={(e) => void onPick(e.target.value)}
        data-testid={`code-ghost-evidence-${code.code}`}
      >
        <option value="inherit">{t('codeGhost.inherit')}</option>
        <option value="on">{t('codeGhost.on')}</option>
        <option value="off">{t('codeGhost.off')}</option>
      </select>
    </MetaPair>
  );
}

// PromptCol —— #104：这张码挂的 per-code prompt（引 prompts 库）。没挂 → 不渲染。
function PromptCol({ code }: { code: CodeView }) {
  const hook = usePrompts();
  const name = resolvePromptName(hook.prompts, code.prompt_id);
  return name === null ? null : (
    <MetaPair label="prompt">
      <a
        href="/admin/prompts"
        className="mono text-[12.5px] tracking-[0.02em] text-(--color-ink) underline decoration-(--color-accent)/35"
        data-testid={`code-prompt-${code.code}`}
      >
        {name} ↗
      </a>
    </MetaPair>
  );
}

function resolvePromptName(
  prompts: readonly PromptView[], promptID: string | null | undefined,
): string | null {
  return promptID ? namePartOrShortID(prompts.find((p) => p.id === promptID), promptID) : null;
}

function namePartOrShortID(found: PromptView | undefined, promptID: string): string {
  return found ? found.name : `${promptID.slice(0, 8)}…`;
}

function RoleCol({ code }: { code: CodeView }) {
  return (
    <MetaPair label="role">
      <div className="flex flex-col gap-1">
        <RoleLink roleID={code.assumed_role_id} />
        <RoleFrozenLine />
      </div>
    </MetaPair>
  );
}

// RoleLink —— 这张码假定的 role，**按名字**。原来印的是 `roleID.slice(0, 8)}…`，一截 UUID：
// 卡上其它每一处都是人话，唯独这里要 owner 拿 `e1db285a…` 去跟 /admin/roles 对。role 的名字正是
// owner 自己起的（"public"/"ext-mcp-verify"），是这张码给谁看的唯一线索。
// rolesStore 是共享 resource store，每张卡都调也只有一次 GET。
// roleLabel —— 名字优先；还没拉到就先退回一截 ID（宁可难看，不给一个会跳的空白）。
function roleLabel(roles: readonly { id: string; name: string }[], roleID: string): string {
  return roles.find((r) => r.id === roleID)?.name ?? `${roleID.slice(0, 8)}…`;
}

function RoleLink({ roleID }: { roleID: string }) {
  const { roles } = useRoles();
  const label = roleLabel(roles, roleID);
  return (
    <a
      href="/admin/roles"
      className="mono text-[12.5px] tracking-[0.02em] text-(--color-ink) underline decoration-(--color-accent)/35"
      data-testid={`code-role-${roleID}`}
      title={label}
    >
      {label} ↗
    </a>
  );
}

function RoleFrozenLine() {
  const t = useTranslations('adminAccess');
  return (
    <div
      className="mono text-[9.5px] tracking-[0.04em] text-(--color-faint) mt-1"
      data-testid="code-role-frozen"
    >
      {t('codeCard.roleFrozen')}
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
      <span data-testid="code-qr"><QRCode value={link} size={72} /></span>
    </MetaPair>
  );
}

function QuotaBar({ code }: { code: CodeView }) {
  const t = useTranslations('adminAccess');
  const sessions = quotaSummary(code.max_members, 'names');
  const turns = quotaSummary(code.max_turns_per_session, 'turns');
  return (
    <div className="col-span-full" data-testid={`code-quotas-${code.code}`}>
      <div className="mono text-[10px] tracking-[0.12em] uppercase text-(--color-muted) mb-1.5">{t('codeCard.quota')}</div>
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

// A.3-IAM-5: ScopeBlock / PathPerm / UnrestrictedHint 删 —— ACL 从 role 推断。




function CodeCardFooter({ code, link }: { code: CodeView; link: string }) {
  return (
    <div className="mt-5 pt-3 border-t border-(--color-rule)/60">
      <FooterTop status={code.status} link={link} expiresAt={code.expires_at} />
      <ConversationsLink code={code.code} />
    </div>
  );
}

function FooterTop({ status, link, expiresAt }: {
  status: string; link: string; expiresAt?: string;
}) {
  const t = useTranslations('adminAccess');
  return (
    <div className="mono text-[10px] tracking-[0.12em] text-(--color-faint) flex items-baseline justify-between gap-3 flex-wrap">
      <span>{t('codeCard.status', { status })}<ExpiryText iso={expiresAt} /></span>
      <span className="truncate min-w-0">{link}</span>
    </div>
  );
}

// ExpiryText —— 显式标过期:有 expires_at 显日期,没有显「no expiry」。过期由
// expires_at 计算(domain 注释:不写 status 字段),owner 一眼看清这码什么时候失效。
function ExpiryText({ iso }: { iso?: string }) {
  return (
    <span className="ml-2 text-(--color-muted)" data-testid="code-expiry">
      {iso ? `· expires ${iso.slice(0, 10)}` : '· no expiry'}
    </span>
  );
}

function ConversationsLink({ code }: { code: string }) {
  const t = useTranslations('adminAccess');
  return (
    <Link
      href={`/admin/conversations?code=${encodeURIComponent(code)}`}
      className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-accent) mt-3 inline-block"
    >
      {t('codeCard.viewConversations')}
    </Link>
  );
}
