// PinManager — pin editor for one section (insights|projects). Those two
// sections on the home page are a pin window over the corpus: this component
// only maintains "which published entries, in what order" — the content
// itself lives only in the corpus.
//
// The candidate pool = usePinnable() (GET /page/pinnable, published entries
// only). Add/remove/reorder edits a list of wiki ids, handed to
// usePageEditor.patch; once dirty, SaveBar does one unified PUT. An empty pool
// prompts the owner to publish something first (invariant: pinned ⊆
// published — pins can only pick from published entries).

'use client';

import { useState } from 'react';

import { useTranslations } from 'next-intl';

import type { PinnableEntry } from '@/lib/api/admin';

interface Props {
  section: 'insights' | 'projects';
  pins: readonly string[];
  pinnable: readonly PinnableEntry[];
  onChange: (pins: string[]) => void;
}

export function PinManager({ section, pins, pinnable, onChange }: Props) {
  const [picking, setPicking] = useState(false);
  const byID = new Map(pinnable.map((p) => [p.id, p]));
  const available = pinnable.filter((p) => !pins.includes(p.id));
  return (
    <div className="space-y-3">
      <PinnedList section={section} pins={pins} byID={byID} onChange={onChange} />
      <AddRow
        section={section}
        picking={picking}
        available={available}
        onToggle={() => setPicking((v) => !v)}
        onPick={(id) => { onChange([...pins, id]); setPicking(false); }}
      />
    </div>
  );
}

function PinnedList({
  section, pins, byID, onChange,
}: {
  section: string;
  pins: readonly string[];
  byID: Map<string, PinnableEntry>;
  onChange: (pins: string[]) => void;
}) {
  return pins.length === 0 ? <EmptyNote /> : (
    <ol className="space-y-1.5">
      {pins.map((id, i) => (
        <PinnedRow
          key={id}
          section={section}
          idx={i}
          total={pins.length}
          label={byID.get(id)?.title ?? id}
          onRemove={() => onChange(pins.filter((p) => p !== id))}
          onMove={(dir) => onChange(movePin(pins, i, dir))}
        />
      ))}
    </ol>
  );
}

function EmptyNote() {
  const t = useTranslations('adminPages.pinManager');
  return <p className="mono text-[11px] text-(--color-faint) tracking-[0.04em]">{t('empty')}</p>;
}

function PinnedRow({
  section, idx, total, label, onRemove, onMove,
}: {
  section: string;
  idx: number;
  total: number;
  label: string;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const t = useTranslations('adminPages.pinManager');
  return (
    <li
      data-testid={`pin-row-${section}-${idx}`}
      className="flex items-center gap-3 border border-(--color-rule) px-3 py-2"
    >
      <span className="mono text-[10px] text-(--color-faint) tabular-nums">{String(idx + 1).padStart(2, '0')}</span>
      <span className="flex-1 font-serif text-(--color-ink) text-[15px] truncate">{label}</span>
      <MoveBtn dir={-1} disabled={idx === 0} onMove={onMove} glyph="↑" />
      <MoveBtn dir={1} disabled={idx === total - 1} onMove={onMove} glyph="↓" />
      <button
        type="button"
        onClick={onRemove}
        className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-accent) transition-colors"
      >
        {t('unpin')}
      </button>
    </li>
  );
}

function MoveBtn({
  dir, disabled, onMove, glyph,
}: { dir: -1 | 1; disabled: boolean; onMove: (dir: -1 | 1) => void; glyph: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onMove(dir)}
      className="mono text-[11px] text-(--color-muted) hover:text-(--color-accent) disabled:opacity-25 transition-colors"
    >
      {glyph}
    </button>
  );
}

function AddRow({
  section, picking, available, onToggle, onPick,
}: {
  section: 'insights' | 'projects';
  picking: boolean;
  available: readonly PinnableEntry[];
  onToggle: () => void;
  onPick: (id: string) => void;
}) {
  const t = useTranslations('adminPages.pinManager');
  return (
    <div>
      <button
        type="button"
        data-testid={`pin-add-${section}`}
        onClick={onToggle}
        className="mono text-[11px] tracking-[0.14em] uppercase text-(--color-accent) hover:underline"
      >
        {picking ? t('close') : t('add')}
      </button>
      {picking && <PickList available={available} onPick={onPick} />}
    </div>
  );
}

function PickList({
  available, onPick,
}: { available: readonly PinnableEntry[]; onPick: (id: string) => void }) {
  const t = useTranslations('adminPages.pinManager');
  return available.length === 0 ? (
    <p className="mono text-[11px] text-(--color-faint) tracking-[0.04em] mt-2">{t('noneToPin')}</p>
  ) : (
    <ul className="mt-2 border border-(--color-rule) divide-y divide-(--color-rule)">
      {available.map((p) => (
        <li key={p.id}>
          <button
            type="button"
            data-testid={`pin-option-${p.id}`}
            onClick={() => onPick(p.id)}
            className="w-full text-left px-3 py-2 font-serif text-[15px] text-(--color-ink) hover:bg-(--color-rule)/30 transition-colors"
          >
            {p.title}
            <span className="mono text-[10px] text-(--color-faint) ml-2">{p.path}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function movePin(pins: readonly string[], idx: number, dir: -1 | 1): string[] {
  const next = [...pins];
  const target = idx + dir;
  const outOfRange = target < 0 || target >= next.length;
  return outOfRange ? next : swap(next, idx, target);
}

function swap(arr: string[], i: number, j: number): string[] {
  [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  return arr;
}
