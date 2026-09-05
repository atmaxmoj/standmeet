// CodeCard — list card for the Codes section.
// Top: label + status pill; below: scope chips + suggested questions + QR tile.

import { CodeCorpusConfig } from '@/components/admin/sections/codes/CodeCorpusConfig';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { Btn } from '@/components/admin/atoms/Btn';
import { MetaPair } from '@/components/admin/atoms/MetaPair';
import { QRCode } from '@/components/admin/atoms/QRCode';
import { MembersBlock } from '@/components/admin/sections/codes/MembersBlock';
import { SelectField } from '@/components/atoms/SelectField';
import { buildShareLink } from '@/lib/admin/code-share';
import { ghostFromSelect, ghostToSelect } from '@/lib/admin/code-ghost';
import { usePrompts, type PromptView } from '@/lib/admin/use-prompts';
import { useRoles } from '@/lib/admin/use-roles';
import { useAction } from '@/lib/ui/use-action';

import { useCodes, type CodeView } from '@/lib/admin/use-codes';
import { useMicrosites } from '@/lib/admin/use-microsites';

type Props = {
  code: CodeView;
  onEdit: (c: CodeView) => void;
  onPreview: (c: CodeView) => void;
  onShowQR: (c: CodeView) => void;
  onRevoke: (c: CodeView) => void;
};

// A revoked code card **must recede visually** (UX-88). This page answers "who can get in
// right now" — and 7 of 13 cards here are already revoked. Before this change they were just
// as visually loud as live codes: same title weight, same QR code, same quota bar, differing
// only by one small word. The eye couldn't tell which cards still counted on a single screen.
//
// What recedes is **visual weight**, not content: owner must still be able to inspect what an
// old code once granted (so this never collapses or hides the card).
const DEAD_CARD = 'opacity-55 saturate-50';

export function CodeCard({ code, onEdit, onPreview, onShowQR, onRevoke }: Props) {
  const link = buildShareLink(code.code);
  const dead = code.status !== 'active';
  return (
    <article
      className={`crosshair border border-(--color-rule) bg-(--color-surface)/30 p-5 rounded-sm${dead ? ` ${DEAD_CARD}` : ''}`}
      data-testid={`code-card-${code.code}`}
    >
      <span className="ch-tl" /><span className="ch-br" />
      <CodeCardHeader code={code} onEdit={onEdit} onPreview={onPreview} onRevoke={onRevoke} />
      <div className="mt-5">
        <CodeCardBody code={code} onShowQR={onShowQR} />
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

function CodeCardBody({ code, onShowQR }: { code: CodeView; onShowQR: (c: CodeView) => void }) {
  return (
    <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-3 gap-5">
      <MembersCol codeID={code.id} code={code.code} />
      <RoleCol code={code} />
      <PromptCol code={code} />
      <GhostEvidenceCol code={code} />
      <OpensCol code={code} />
      <QRCol code={code} onShowQR={onShowQR} />
      <QuotaBar code={code} />
    </div>
  );
}

// GhostEvidenceCol — F-A-10 per-code override of the ghost-evidence rule. 3 states:
// inherit (inherits from role, null) / require (evidence mandatory, true) / allow (no
// restriction, false). Code overrides role. Save → PATCH /ghost-evidence.
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
      <SelectField
        className="min-w-0 max-w-full"
        mono
        value={ghostToSelect(code.require_ghost_evidence)}
        onChange={(e) => void onPick(e.target.value)}
        testid={`code-ghost-evidence-${code.code}`}
      >
        <option value="inherit">{t('codeGhost.inherit')}</option>
        <option value="on">{t('codeGhost.on')}</option>
        <option value="off">{t('codeGhost.off')}</option>
      </SelectField>
    </MetaPair>
  );
}

// PromptCol — #104: the per-code prompt attached to this code (references the prompts
// library). Nothing attached → renders nothing.
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

// RoleLink — the role this code assumes, shown **by name**. It used to print
// `roleID.slice(0, 8)}…`, a truncated UUID: every other spot on the card reads in plain
// language, but here the owner had to cross-reference `e1db285a…` against /admin/roles.
// The role's name is exactly what the owner named it ("public"/"ext-mcp-verify") — the only
// clue to who this code is meant for.
// rolesStore is a shared resource store, so every card calling it still fires only one GET.
// roleLabel — prefer the name; fall back to a truncated ID before it loads (better ugly than
// a blank that jumps).
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

// QRCol — the small QR on the card **is** the share entry point: clicking it opens a large
// image + a copyable link + print (F-D-12).
//
// Before this fix, `CodeCard` accepted `onShowQR` as `_onShowQR` (the "deliberately unused"
// convention): the whole wire was cut right at the card, so `CodeQRModal` — the **only**
// place in the product with a copy-link action — was unreachable, and the owner had to hand
// out a code by copying that URL off the card by hand. A 72px QR isn't meant to be scanned
// anyway.
function QRCol({ code, onShowQR }: { code: CodeView; onShowQR: (c: CodeView) => void }) {
  const t = useTranslations('adminAccess');
  const link = buildShareLink(code.code);
  return (
    <MetaPair label="QR">
      <button
        type="button"
        onClick={() => onShowQR(code)}
        data-testid="code-qr-open"
        title={t('codeCard.openShare')}
        className="cursor-pointer hover:opacity-70 transition-opacity"
      >
        <span data-testid="code-qr"><QRCode value={link} size={72} /></span>
      </button>
    </MetaPair>
  );
}

// OpensCol — what this code opens when scanned. Defaults to the visitor chat; attaching a
// page switches it to that page ("pages give a code a rendering").
//
// **The binding lives on the code**, so "at most one page per code" is baked into this
// dropdown's shape itself — single-select, picking a new one replaces the old one, there is
// no "add another page" action available. The empty option = unbind, spelled out explicitly
// as "visitor chat": without that, "no page attached" and "this build just doesn't show the
// binding yet" would look identical on screen.
function OpensCol({ code }: { code: CodeView }) {
  const t = useTranslations('adminAccess');
  const { setMicrosite } = useCodes();
  const { rows } = useMicrosites();
  const run = useAction();
  const onPick = (slug: string) => run(
    () => setMicrosite(code.id, slug),
    { success: `${code.code} now opens ${slug === '' ? 'the visitor chat' : `/p/${slug}`}` },
  );
  return (
    // col-span-full — this cell holds **an address** (`/p/reading-room`), not a short word.
    // Squeezed into a three-column grid it truncated its own value to `the visitor ch⌄`: a
    // dropdown the owner can't finish reading, unable to tell which page this code opens
    // (UX-99).
    <MetaPair label={t('codeCard.opensLabel')} className="col-span-full sm:col-span-2">
      <SelectField
        className="w-full"
        mono
        value={code.microsite_slug}
        onChange={(e) => void onPick(e.target.value)}
        testid={`code-opens-${code.code}`}
      >
        <option value="">{t('codeCard.opensChat')}</option>
        {rows.map((p) => (
          <option key={p.id} value={p.slug}>{t('codeCard.opensPageOption', { slug: p.slug })}</option>
        ))}
      </SelectField>
    </MetaPair>
  );
}

function QuotaBar({ code }: { code: CodeView }) {
  const t = useTranslations('adminAccess');
  // The quota reads **used / total**, not just "total". Showing only the cap makes a full
  // code and a brand-new code look identical on this card, while the visitor side is
  // already blocked by member_quota_reached — neither side can see it, so no one can act on
  // it (F-D-2). The visitor header bar has always shown it this way: "1 / 5 names".
  const sessions = usageSummary(code.member_count, code.max_members, 'names');
  const turns = quotaSummary(code.max_turns_per_session, 'turns');
  const filled = fillPercent(code.member_count, code.max_members);
  return (
    <div className="col-span-full" data-testid={`code-quotas-${code.code}`}>
      <div className="mono text-[10px] tracking-[0.12em] uppercase text-(--color-muted) mb-1.5">{t('codeCard.quota')}</div>
      <div className="flex items-center gap-3">
        <div className="flex-1 h-[4px] bg-(--color-rule) rounded-full overflow-hidden">
          {/* Width is this code's real usage ratio (0-100): differs per card, changes as
              members join. Tailwind's fixed step scale can't express it — and that
              inability to express it is exactly why the previous version hardcoded w-0
              (F-D-2). */}
          <div
            className="h-full bg-(--color-ink) rounded-full"
            // eslint-disable-next-line no-restricted-syntax -- ratio computed at runtime, see above
            style={{ width: `${filled}%` }}
            data-testid={`code-quota-fill-${code.code}`}
          />
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

// usageSummary — write "used / total" when there's a cap; even uncapped codes should show
// how many joined: an unlimited code is still worth knowing the headcount for.
function usageSummary(used: number, cap: number | null | undefined, label: string): string {
  return cap && cap > 0 ? `${used} / ${cap} ${label}` : `${used} ${label} · unlimited`;
}

// fillPercent — leave it empty when uncapped (any fill value would be fake); cap at 100 when
// there's a limit: 11/10 has really happened, and showing it as full beats blowing out the
// container.
function fillPercent(used: number, cap: number | null | undefined): number {
  return cap && cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
}

// A.3-IAM-5: ScopeBlock / PathPerm / UnrestrictedHint removed — ACL is inferred from role.




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

// ExpiryText — expiry shown explicitly: with expires_at, show the date; without it, show
// "no expiry". Expiry is computed from expires_at (domain note: no separate status field),
// so the owner can see at a glance when this code stops working.
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
