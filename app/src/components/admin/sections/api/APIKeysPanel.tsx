// APIKeysPanel — the **outbound API key** block on /admin/api-mcp (F-K-1).
//
// Don't confuse this with the MCP keypair list on the same page
// ([[two-mcp-surfaces]]): that one is the Ed25519 keypair owner's own
// client uses to sign; this one is the `smk_` key a third-party program
// uses to hit `/api/pub/v1`.
//
// **Why this block has to exist**: before it, outbound keys only lived on
// owner-MCP, so a leaked key could only be revoked after owner had
// installed and run an MCP client. The bleeding-stop path shouldn't
// require installing a tool first. The design always meant the two
// surfaces to be twins (`docs/design/facade-directions.md:202-206`).
//
// Plaintext shows only at the moment it's minted; after that the list
// only keeps the prefix — this page must never become a place to harvest
// keys from.

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { AdminSectionHead } from '@/components/admin/AdminSectionHead';
import { ListPane } from '@/components/admin/ListPane';
import { SelectField } from '@/components/atoms/SelectField';
import { useAPIKeys, type APIKeyItem } from '@/lib/admin/use-api-keys';
import { useRoles } from '@/lib/admin/use-roles';
import { useAction } from '@/lib/ui/use-action';

// INPUT_CLASS — the existing input style on this page (bottom border only,
// not all four sides). **Copy it, don't invent one**: my first version wrote
// an `sm-input` class that didn't exist at all, and `check-sm-class-defined.sh`
// exists exactly for this "looks like an atom, generates nothing" failure
// mode ([[computed-class-generates-nothing]]).
const INPUT_CLASS =
  'w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 ' +
  'reading-tight text-base';

export function APIKeysPanel() {
  const t = useTranslations('adminIntegrations.apiKeys');
  const hook = useAPIKeys();
  const roles = useRoles();
  return (
    <div data-testid="api-keys-panel">
      <AdminSectionHead>{t('heading')}</AdminSectionHead>
      <p className="sm-measure text-[13px] text-(--color-muted) mb-3">{t('intro')}</p>
      <NewSecret created={hook.justCreated} onDismiss={hook.dismissCreated} />
      <MintRow
        hook={hook}
        roleIDs={roles.roles.map((r) => ({ id: r.id, name: r.name }))}
        fallbackRole={firstRoleID(roles.roles)}
      />
      <KeyList keys={hook.keys} hook={hook} />
    </div>
  );
}

// firstRoleID — pure value lookup, not rendering; kept outside the
// component so the presentation layer stays at cyclo ≤3.
function firstRoleID(roles: readonly { id: string }[]): string {
  return roles[0]?.id ?? '';
}

// NewSecret — plaintext appears only this once. Copy must say "you can't
// get this back later", or owner will assume they can look at it again.
// **The null branch is handled in here**: keeps the call site branch-free
// (presentation layer stays at cyclo ≤3).
function NewSecret(
  { created, onDismiss }: { created: { secret: string } | null; onDismiss: () => void },
) {
  const t = useTranslations('adminIntegrations.apiKeys');
  return created === null ? null : (
    <div className="border border-(--color-accent) p-3 mb-3">
      <div className="sm-smallcaps mb-1">{t('secretOnce')}</div>
      <code data-testid="api-key-new-secret" className="mono text-[12px] break-all block">
        {created.secret}
      </code>
      <button type="button" onClick={onDismiss} className="sm-btn sm-btn-ghost sm-btn-sm mt-2">
        {t('dismiss')}
      </button>
    </div>
  );
}

interface MintProps {
  hook: ReturnType<typeof useAPIKeys>;
  roleIDs: { id: string; name: string }[];
  // fallbackRole — which role to use when none is picked yet. **The parent
  // component computes it and passes it down**: presentation layer stays at
  // cyclo ≤3, and putting the "take the first one" branch here would blow it.
  fallbackRole: string;
}

function MintRow({ hook, roleIDs, fallbackRole }: MintProps) {
  const t = useTranslations('adminIntegrations.apiKeys');
  const [label, setLabel] = useState('');
  const [roleID, setRoleID] = useState('');
  const run = useAction();
  const mint = () => void run(async () => {
    await hook.createKey(label, roleID || fallbackRole);
    setLabel('');
  });
  return (
    <div className="flex items-end gap-3 mb-4 flex-wrap">
      <label className="flex-1 min-w-[180px]">
        <span className="sm-smallcaps block mb-1">{t('labelField')}</span>
        <input
          data-testid="api-key-new-label" value={label}
          onChange={(e) => { setLabel(e.target.value); }}
          className={INPUT_CLASS} placeholder={t('labelPlaceholder')}
        />
      </label>
      <label>
        <span className="sm-smallcaps block mb-1">{t('roleField')}</span>
        {/* SelectField instead of a bare <select> — dropdowns must have one
            look only (the gate check-one-select left by UX-47 caught me
            red-handed). */}
        <SelectField
          testid="api-key-new-role" value={roleID}
          onChange={(e) => { setRoleID(e.target.value); }}
        >
          {roleIDs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </SelectField>
      </label>
      <button
        type="button" data-testid="api-key-new-create"
        // **Disabled when there's no role to assume yet.** The role list
        // arrives async, and this button lights up as soon as the label is
        // filled; clicking before the list is back leaves `assumed_role_id`
        // empty, and the backend always 400s — a **clickable button doomed
        // to fail** ([[button-that-cannot-be-wired]]). This isn't a race-
        // condition patch: with no role, minting a key has no meaning at all.
        disabled={label.trim() === '' || fallbackRole === ''}
        onClick={mint}
        className="sm-btn sm-btn-solid sm-btn-sm"
      >
        {t('mint')}
      </button>
    </div>
  );
}


// KeyList — the three states go through ListPane (F-L-53: this spot was
// caught the moment `check-one-empty-state` was widened).
// "no keys yet · generate one to wire up your first AI client" is a line
// owner will take at face value: on a failed fetch it reads as "this
// instance has no keys", when the truth may be that the keys he already
// handed out are still in active use.
function KeyList({ keys, hook }: { keys: readonly APIKeyItem[]; hook: ReturnType<typeof useAPIKeys> }) {
  const t = useTranslations('adminIntegrations.apiKeys');
  return (
    <ListPane
      status={hook.status}
      count={keys.length}
      empty={<div className="sm-empty mono text-[11px] text-(--color-faint)">{t('empty')}</div>}
    >
      <ul className="space-y-2">
        {keys.map((k) => <KeyRow key={k.id} row={k} hook={hook} />)}
      </ul>
    </ListPane>
  );
}

const ROW_BASE = 'flex items-baseline gap-3 border-b border-(--color-rule)/60 pb-2';

// rowCls — a live row stays as-is; a revoked row loses saturation.
const rowCls = (live: boolean): string => (live ? ROW_BASE : `${ROW_BASE} opacity-55 saturate-50`);

// KeyRow — one row per key. **Only the prefix shows**, plaintext never does.
//
// A revoked row **fades into the background** (UX-91, the same rule as
// UX-88 on the codes side): this table answers "whose program can connect
// right now", and a revoked row used to sit at the same visual weight as a
// live one, differing only by one word. Fade weight, not content — owner
// still needs to look up who an old key was ever given to.
function KeyRow({ row, hook }: { row: APIKeyItem; hook: ReturnType<typeof useAPIKeys> }) {
  const t = useTranslations('adminIntegrations.apiKeys');
  const run = useAction();
  const live = row.status === 'active';
  return (
    <li className={rowCls(live)}>
      <span className="font-serif text-[15px] flex-1">{row.label}</span>
      <code className="mono text-[11px] text-(--color-muted)">{row.prefix}…</code>
      <span className="mono text-[10px] uppercase tracking-[0.14em] text-(--color-faint)">
        {live ? t('statusActive') : t('statusRevoked')}
      </span>
      {live ? (
        <button
          type="button" data-testid={`api-key-revoke-${row.label}`}
          // Revoking is irreversible, so ask first — same convention as
          // wiki delete.
          onClick={() => {
            confirm(t('revokeConfirm'))
              && void run(async () => { await hook.revokeKey(row.id); });
          }}
          className="sm-btn sm-btn-ghost sm-btn-sm"
        >
          {t('revoke')}
        </button>
      ) : null}
    </li>
  );
}
