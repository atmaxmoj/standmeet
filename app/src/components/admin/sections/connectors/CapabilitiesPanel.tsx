// CapabilitiesPanel — Phase H admin "capabilities" card. Lists every capability + connector +
// skill, one row each: name + origin badge (builtin/managed/owner) + owner-enable toggle
// (builtin can be disabled but not deleted, P.7) + connector dependency status + delete entry
// for owner-origin rows only (P.6). Follows the connector card's visual language (crosshair +
// mono kicker).

'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';

import { AdminSectionHead } from '@/components/admin/AdminSectionHead';
import { ListPane } from '@/components/admin/ListPane';
import {
  useCapabilities, dependencyHint,
  type CapabilityRow, type CapabilitiesHook,
} from '@/lib/admin/use-capabilities';
import { useAction } from '@/lib/ui/use-action';
import { useReportError } from '@/lib/ui/use-report-error';

export function CapabilitiesPanel() {
  const hook = useCapabilities();
  const { ensureLoaded } = hook;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return (
    <section
      className="crosshair border border-(--color-rule) rounded-sm bg-(--color-surface)/30 p-5"
      data-testid="capabilities-panel"
    >
      <span className="ch-tl" /><span className="ch-br" />
      <Header />
      <Body hook={hook} />
    </section>
  );
}

function Header() {
  const t = useTranslations('adminIntegrations.capabilities');
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
function Body({ hook }: { hook: CapabilitiesHook }) {
  return (
    <ListPane
      status={hook.status}
      count={hook.rows.length}
      empty={<Msg text="no capabilities registered." />}
      skeleton={<Msg text="loading…" />}
    >
      <CapList hook={hook} />
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

// available — this panel is the "availability" plane: a capability that depends on a connector
// only shows once that dependency is connected (it's only really usable once connected; delete
// the provider / disconnect → hide again). Capabilities with no dependency always show. The API
// still lists everything (with dependency status attached).
function available(row: CapabilityRow): boolean {
  return !row.dependency || row.dependency.connected;
}

function CapList({ hook }: { hook: CapabilitiesHook }) {
  return (
    <ul className="divide-y divide-(--color-rule)/60">
      {hook.rows.filter(available).map((row) => (
        <CapabilityItem key={row.id} row={row} hook={hook} />
      ))}
    </ul>
  );
}

function CapabilityItem({ row, hook }: { row: CapabilityRow; hook: CapabilitiesHook }) {
  const hint = dependencyHint(row);
  return (
    <li className="flex items-center gap-3 py-3" data-testid={`capability-row-${row.id}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm text-(--color-ink)">{capabilityLabel(row)}</span>
          <OriginBadge row={row} />
          <KindBadge row={row} />
        </div>
        {hint && <p className="mt-0.5 mono text-[10px] text-(--color-accent)">{hint}</p>}
      </div>
      <EnableToggle row={row} hook={hook} />
      <DeleteBtn row={row} hook={hook} />
    </li>
  );
}

// capabilityLabel — what this row is called.
//
// A built-in capability's id already reads like a human sentence (`mail.send`), so rendering
// the id directly has always looked fine; an owner-written skill's id is a UUID, so that row
// is left with a block of hex — right next to the toggle and the delete button, forcing the
// owner to decide enable/delete on a name they can't recognize. The same skill already has a
// name on /admin/skills.
//
// `title` has been in this table's schema all along (the dock button dropdown uses it); this
// panel had just never read it.
function capabilityLabel(row: CapabilityRow): string {
  return row.title === undefined || row.title === '' ? row.id : row.title;
}

const BADGE_BASE =
  'inline-flex items-center px-1.5 py-0.5 border rounded-sm mono ' +
  'text-[10px] tracking-[0.04em] lowercase leading-[1.3]';

function OriginBadge({ row }: { row: CapabilityRow }) {
  const tone =
    row.origin === 'owner'
      ? 'text-(--color-accent) border-(--color-accent)/50'
      : 'text-(--color-muted) border-(--color-rule)';
  return <span className={`${BADGE_BASE} ${tone}`} data-testid={`origin-${row.id}`}>{row.origin}</span>;
}

function KindBadge({ row }: { row: CapabilityRow }) {
  return row.kind === 'capability'
    ? null
    : <span className={`${BADGE_BASE} text-(--color-muted) border-(--color-rule)`}>{row.kind}</span>;
}

// A connector row's `enabled` reflects connection state and can't be toggled by hand
// (connect/disconnect happens on that connector's own card).
function toggleTrackClass(enabled: boolean, locked: boolean): string {
  const tint = enabled
    ? 'bg-(--color-ink) border-(--color-ink)'
    : 'bg-transparent border-(--color-rule)';
  const cursor = locked ? ' opacity-40 cursor-not-allowed' : ' cursor-pointer';
  return `relative h-5 w-9 shrink-0 rounded-full border transition-colors ${tint}${cursor}`;
}

function toggleKnobClass(enabled: boolean): string {
  const pos = enabled ? 'left-[18px] bg-(--color-paper)' : 'left-0.5 bg-(--color-muted)';
  return `absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${pos}`;
}

function EnableToggle({ row, hook }: { row: CapabilityRow; hook: CapabilitiesHook }) {
  const report = useReportError();
  const locked = row.kind === 'connector';
  // Pessimistic toggle: store-driven (no optimistic mutate), only moves once the server
  // confirms. Never swallow a failure (the old `void` swallowed it → a "disabled" capability
  // could still be live, a safety hole); no success toast either — the toggle moving is
  // already the feedback.
  return (
    <button
      type="button"
      role="switch"
      aria-checked={row.enabled}
      disabled={locked}
      data-testid={`toggle-${row.id}`}
      onClick={() => { void hook.setEnabled(row.id, !row.enabled).catch(report); }}
      className={toggleTrackClass(row.enabled, locked)}
    >
      <span className={toggleKnobClass(row.enabled)} />
    </button>
  );
}

function DeleteBtn({ row, hook }: { row: CapabilityRow; hook: CapabilitiesHook }) {
  const run = useAction();
  const t = useTranslations('adminIntegrations.common');
  return row.deletable
    ? (
      <button
        type="button"
        data-testid={`delete-${row.id}`}
        title="remove capability"
        onClick={() => { void run(() => hook.remove(row.id), { success: 'Capability removed' }); }}
        className="w-6 shrink-0 text-(--color-muted) hover:text-(--color-accent) transition-colors"
      >
        {t('close')}
      </button>
    )
    : <span className="w-6 shrink-0" aria-hidden />;
}
