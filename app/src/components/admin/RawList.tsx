// RawList —— /admin/raw section 内容。fetch /api/admin/raw 后渲染。

'use client';

import { useEffect, useState } from 'react';

import { SectionHeader } from './SectionHeader';

import { adminAPI, type RawAdminView } from '@/lib/api/admin';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; rows: RawAdminView[] }
  | { kind: 'error'; message: string };

export function RawList() {
  const state = useRawEntries();
  return (
    <>
      <SectionHeader title="raw" subtitle="AI-pushed dumps from your MCP clients" />
      <RawListBody state={state} />
    </>
  );
}

function RawListBody({ state }: { state: LoadState }) {
  return state.kind === 'loading' ? <LoadingMsg />
    : state.kind === 'error' ? <ErrorMsg message={state.message} />
    : <RawTable rows={state.rows} />;
}

function LoadingMsg() {
  return <p className="mono text-(--color-muted)">loading…</p>;
}

function ErrorMsg({ message }: { message: string }) {
  return <p className="mono text-(--color-accent)">{message}</p>;
}

function RawTable({ rows }: { rows: RawAdminView[] }) {
  return rows.length === 0
    ? <EmptyState />
    : (
      <ul className="space-y-6" data-testid="raw-list">
        {rows.map((r) => <RawRow key={r.id} row={r} />)}
      </ul>
    );
}

function EmptyState() {
  return (
    <p className="reading italic text-(--color-muted)">
      No raw entries yet. Push one from an MCP client (raw_dump tool).
    </p>
  );
}

function RawRow({ row }: { row: RawAdminView }) {
  return (
    <li className="border-b border-(--color-rule) pb-4">
      <div className="mono text-[10px] tracking-[0.04em] text-(--color-muted) mb-2">
        {row.source} · {row.tags.join(' · ')}
      </div>
      <p className="reading">{row.body}</p>
    </li>
  );
}

function useRawEntries(): LoadState {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  useEffect(() => {
    let cancelled = false;
    void loadRaw(cancelled, setState);
    return () => { cancelled = true; };
  }, []);
  return state;
}

async function loadRaw(
  cancelled: boolean, setState: (s: LoadState) => void,
): Promise<void> {
  const result = await fetchRaw();
  cancelled || setState(result);
}

async function fetchRaw(): Promise<LoadState> {
  try {
    const rows = await adminAPI.get<RawAdminView[]>('/raw');
    return { kind: 'ready', rows };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : 'failed' };
  }
}
