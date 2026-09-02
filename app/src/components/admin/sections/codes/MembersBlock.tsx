// MembersBlock — the "members" disclosure block at the bottom of CodeCard.
//
// The owner clicks "members ↓" to expand every visitor under this code (sorted by
// last_seen), read-only. Revoke operates at the AccessCode level (the revoke button at the
// top of the card), not on an individual member — a member is just the (code, name)
// footprint left behind, not a separately manageable entity.

'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useMembers, type MembersHook } from '@/lib/admin/use-members';
import type { MemberView } from '@/lib/admin/use-codes';

type Props = { codeID: string; code: string };

export function MembersBlock({ codeID, code }: Props) {
  const [open, setOpen] = useState(false);
  const hook = useMembers(codeID, open);
  return (
    <div className="mt-4">
      <ToggleBtn open={open} onToggle={() => setOpen((v) => !v)} code={code} />
      <MembersBody open={open} hook={hook} code={code} />
    </div>
  );
}

function ToggleBtn({
  open, onToggle, code,
}: { open: boolean; onToggle: () => void; code: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      data-testid={`members-toggle-${code}`}
      className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink)"
    >
      {open ? 'members ↑' : 'members ↓'}
    </button>
  );
}

function MembersBody({
  open, hook, code,
}: { open: boolean; hook: MembersHook; code: string }) {
  return open ? <MembersList hook={hook} code={code} /> : null;
}

function MembersList({ hook, code }: { hook: MembersHook; code: string }) {
  const s = hook.state;
  return s.kind === 'ready'
    ? <Rows members={s.members} code={code} />
    : <NonReadyState state={s} />;
}

function NonReadyState({ state }: { state: MembersHook['state'] }) {
  return state.kind === 'loading' ? <Loading />
    : state.kind === 'error' ? <ErrorMsg msg={state.message} />
    : null;
}

function Loading() {
  const t = useTranslations('adminAccess');
  return <p className="mono text-[10.5px] text-(--color-faint) mt-2">{t('members.loading')}</p>;
}

function ErrorMsg({ msg }: { msg: string }) {
  return <p className="mono text-[10.5px] text-(--color-accent) mt-2">{msg}</p>;
}

function Rows({
  members, code,
}: { members: readonly MemberView[]; code: string }) {
  return members.length === 0
    ? <NoMembers />
    : (
      <ul className="mt-2 space-y-1" data-testid={`members-list-${code}`}>
        {members.map((m) => <MemberRow key={m.id} m={m} />)}
      </ul>
    );
}

function NoMembers() {
  const t = useTranslations('adminAccess');
  return (
    <p className="mono text-[10.5px] text-(--color-faint) mt-2">
      {t('members.none')}
    </p>
  );
}

function AnonymousName() {
  const t = useTranslations('adminAccess');
  return <i>{t('members.anonymous')}</i>;
}

function MemberRow({ m }: { m: MemberView }) {
  return (
    <li
      data-testid={`member-row-${m.id}`}
      className="reading-tight text-[13px] py-1 border-b border-(--color-rule)/40"
    >
      <span className="min-w-0 truncate">
        {m.display_name || <AnonymousName />}
      </span>
    </li>
  );
}
