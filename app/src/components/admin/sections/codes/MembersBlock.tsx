// MembersBlock —— CodeCard 底部的"members"展开块。
//
// owner 点 "members ↓" 拉出当前 code 下所有访客（按 last_seen 排），只读。
// revoke 是 AccessCode 级别的（卡顶 revoke 按钮），不针对单个 member——member
// 只是 (code, name) 落地痕迹，不是单独可管的实体。

'use client';

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
  return <p className="mono text-[10.5px] text-(--color-faint) mt-2">loading members…</p>;
}

function ErrorMsg({ msg }: { msg: string }) {
  return <p className="mono text-[10.5px] text-(--color-accent) mt-2">{msg}</p>;
}

function Rows({
  members, code,
}: { members: readonly MemberView[]; code: string }) {
  return members.length === 0
    ? (
      <p className="mono text-[10.5px] text-(--color-faint) mt-2">
        no visitor has used this code yet.
      </p>
    )
    : (
      <ul className="mt-2 space-y-1" data-testid={`members-list-${code}`}>
        {members.map((m) => <MemberRow key={m.id} m={m} />)}
      </ul>
    );
}

function MemberRow({ m }: { m: MemberView }) {
  return (
    <li
      data-testid={`member-row-${m.id}`}
      className="reading-tight text-[13px] py-1 border-b border-(--color-rule)/40"
    >
      <span className="min-w-0 truncate">
        {m.display_name || <i>anonymous</i>}
      </span>
    </li>
  );
}
