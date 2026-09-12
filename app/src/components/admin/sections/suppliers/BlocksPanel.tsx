// BlocksPanel — the admin "blocks" card. Lists every block + supplier +
// skill, one row each: name + origin badge (builtin/managed/owner) + owner-enable toggle
// (builtin can be disabled but not deleted, P.7) + seam dependency status + delete entry
// for owner-origin rows only (P.6). Follows the supplier card's visual language (crosshair +
// mono kicker).

'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { AdminSectionHead } from '@/components/admin/AdminSectionHead';
import { ListPane } from '@/components/admin/ListPane';
import { BlockConfigForm } from '@/components/admin/sections/suppliers/BlockConfigForm';
import { Toggle } from '@/components/atoms/Toggle';
import {
  useBlocks, dependencyHint,
  type BlockRow, type BlocksHook,
} from '@/lib/admin/use-blocks';
import { useAction } from '@/lib/ui/use-action';
import { useReportError } from '@/lib/ui/use-report-error';

export function BlocksPanel() {
  const hook = useBlocks();
  const { ensureLoaded } = hook;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return (
    <section
      className="crosshair border border-(--color-rule) rounded-sm bg-(--color-surface)/30 p-5"
      data-testid="blocks-panel"
    >
      <span className="ch-tl" /><span className="ch-br" />
      <Header />
      <Body hook={hook} />
    </section>
  );
}

function Header() {
  const t = useTranslations('adminIntegrations.blockPanel');
  return (
    <div className="mb-4">
      <AdminSectionHead aside={t('kicker')}>{t('heading')}</AdminSectionHead>
      <p className="mt-2 text-sm text-(--color-muted)">
        {t('intro')}
      </p>
    </div>
  );
}

// Body — this panel already gets the three outcomes right on its own (one of the few places
// in the product that does). It still goes through ListPane because: **doing it right by hand**
// is correct today, but nothing keeps hand-written correctness intact through the next change.
// Once the ordering lives in one place, this is down to two sentences: what to show while
// loading, and what to say when it's really empty (F-N-7).
function Body({ hook }: { hook: BlocksHook }) {
  const t = useTranslations('adminIntegrations.blockPanel');
  return (
    <ListPane
      status={hook.status}
      count={hook.rows.length}
      empty={<Msg text={t('empty')} />}
      skeleton={<Msg text={t('loading')} />}
    >
      <BlockList hook={hook} />
    </ListPane>
  );
}

function Msg({ text, accent = false }: { text: string; accent?: boolean }) {
  return (
    <p className={`mono text-xs ${accent ? 'text-(--color-accent)' : 'text-(--color-muted)'}`}>
      {text}
    </p>
  );
}

// available — this panel is the "availability" plane: a block that depends on a seam
// only shows once that dependency has a connected supplier (it's only really usable then;
// delete the supplier / disconnect → hide again). Blocks with no dependency always show. The
// API still lists everything (with dependency status attached).
function available(row: BlockRow): boolean {
  return !row.dependency || row.dependency.connected;
}

function BlockList({ hook }: { hook: BlocksHook }) {
  return (
    <ul className="divide-y divide-(--color-rule)/60">
      {hook.rows.filter(available).map((row) => (
        <BlockItem key={row.id} row={row} hook={hook} />
      ))}
    </ul>
  );
}

function BlockItem({ row, hook }: { row: BlockRow; hook: BlocksHook }) {
  const hint = dependencyHint(row);
  const [configuring, setConfiguring] = useState(false);
  return (
    <li className="py-3" data-testid={`block-row-${row.id}`}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm text-(--color-ink)">{blockLabel(row)}</span>
            <OriginBadge row={row} />
            <KindBadge row={row} />
          </div>
          {hint && <p className="mt-0.5 mono text-[10px] text-(--color-accent)">{hint}</p>}
        </div>
        <ConfigureBtn row={row} open={configuring} onToggle={() => setConfiguring((v) => !v)} />
        <EnableToggle row={row} hook={hook} />
        <DeleteBtn row={row} hook={hook} />
      </div>
      {configuring && <BlockConfigForm id={row.id} onClose={() => setConfiguring(false)} />}
    </li>
  );
}

// ConfigureBtn — opens the block's own settings.
//
// Offered on every block row rather than on a list of "blocks we know have
// settings": which blocks are configurable is the blocks' business, and a frontend list
// of them is one more place that has to be edited when a block gains a field. A block
// with nothing to configure renders an empty form, which is a truthful and cheap answer.
function ConfigureBtn(
  { row, open, onToggle }: { row: BlockRow; open: boolean; onToggle: () => void },
) {
  const t = useTranslations('adminIntegrations.blocks');
  return row.kind === 'block'
    ? (
      <button
        type="button"
        data-testid="block-configure"
        aria-expanded={open}
        onClick={onToggle}
        className="mono text-[10px] shrink-0 text-(--color-muted) hover:text-(--color-accent)"
      >
        {t('settings')}
      </button>
    )
    : <span className="shrink-0" aria-hidden />;
}

// blockLabel — what this row is called.
//
// A built-in block's id already reads like a human sentence (`mail.send`), so rendering
// the id directly has always looked fine; an owner-written skill's id is a UUID, so that row
// is left with a block of hex — right next to the toggle and the delete button, forcing the
// owner to decide enable/delete on a name they can't recognize. The same skill already has a
// name on /admin/skills.
//
// `title` has been in this table's schema all along (the dock button dropdown uses it); this
// panel had just never read it.
function blockLabel(row: BlockRow): string {
  return row.title === undefined || row.title === '' ? row.id : row.title;
}

const BADGE_BASE =
  'inline-flex items-center px-1.5 py-0.5 border rounded-sm mono ' +
  'text-[10px] tracking-[0.04em] lowercase leading-[1.3]';

function OriginBadge({ row }: { row: BlockRow }) {
  const tone =
    row.origin === 'owner'
      ? 'text-(--color-accent) border-(--color-accent)/50'
      : 'text-(--color-muted) border-(--color-rule)';
  return <span className={`${BADGE_BASE} ${tone}`} data-testid={`origin-${row.id}`}>{row.origin}</span>;
}

function KindBadge({ row }: { row: BlockRow }) {
  return row.kind === 'block'
    ? null
    : <span className={`${BADGE_BASE} text-(--color-muted) border-(--color-rule)`}>{row.kind}</span>;
}

// A supplier row's `enabled` reflects connection state and can't be toggled by hand (connect /
// disconnect happens on that supplier's own card), so it renders locked.
function EnableToggle({ row, hook }: { row: BlockRow; hook: BlocksHook }) {
  const report = useReportError();
  const locked = row.kind === 'supplier';
  // Pessimistic toggle: store-driven (no optimistic mutate), only moves once the server
  // confirms. Never swallow a failure (the old `void` swallowed it → a "disabled" block
  // could still be live, a safety hole); no success toast either — the toggle moving is
  // already the feedback.
  return (
    <Toggle
      on={row.enabled}
      disabled={locked}
      // Row-scoped rather than id-suffixed: the row already carries the id, and a
      // block id with a dot in it (`corpus.retrieval`) reads badly concatenated into
      // a testid. Nothing depended on the old spelling.
      testid="block-enabled-toggle"
      label={blockLabel(row)}
      onToggle={() => { void hook.setEnabled(row.id, !row.enabled).catch(report); }}
    />
  );
}

function DeleteBtn({ row, hook }: { row: BlockRow; hook: BlocksHook }) {
  const run = useAction();
  const t = useTranslations('adminIntegrations.common');
  const tc = useTranslations('adminIntegrations.blockPanel');
  return row.deletable
    ? (
      <button
        type="button"
        data-testid={`delete-${row.id}`}
        title={tc('removeTitle')}
        onClick={() => { void run(() => hook.remove(row.id), { success: tc('removedToast') }); }}
        className="w-6 shrink-0 text-(--color-muted) hover:text-(--color-accent) transition-colors"
      >
        {t('close')}
      </button>
    )
    : <span className="w-6 shrink-0" aria-hidden />;
}
