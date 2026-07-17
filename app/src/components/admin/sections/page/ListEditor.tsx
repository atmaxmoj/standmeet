// ListEditor —— 复杂对象数列编辑。renderRow 是 caller 给出的字段渲染。
// 每行带 ↑↓ 排序 + remove。

import type { ReactNode } from 'react';

import { useTranslations } from 'next-intl';

export interface ListEditorRender<T> {
  empty: () => T;
  row: (item: T, patch: (p: Partial<T>) => void) => ReactNode;
}

type Props<T> = {
  label: string;
  items: readonly T[];
  onChange: (items: T[]) => void;
  render: ListEditorRender<T>;
  renderHint?: string;
};

export function ListEditor<T>(props: Props<T>) {
  return (
    <div>
      <ListHeader label={props.label} renderHint={props.renderHint} onAdd={() => addItem(props)} />
      <Empty shown={props.items.length === 0} />
      <div className="space-y-4">
        {props.items.map((item, i) => (
          <ListRow
            key={i}
            idx={i}
            count={props.items.length}
            child={props.render.row(item, (p) => patchItem(props, i, p))}
            onMove={(d) => moveItem(props, i, d)}
            onRemove={() => removeItem(props, i)}
          />
        ))}
      </div>
    </div>
  );
}

function ListHeader({
  label, renderHint, onAdd,
}: { label: string; renderHint?: string; onAdd: () => void }) {
  const t = useTranslations('adminPages.listEditor');
  return (
    <div className="flex items-baseline justify-between mb-3">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">{label}</div>
      <div className="flex items-baseline gap-4">
        <Hint text={renderHint} />
        <button
          type="button"
          onClick={onAdd}
          className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink)"
        >
          {t('add')}
        </button>
      </div>
    </div>
  );
}

function Hint({ text }: { text?: string }) {
  return text
    ? <span className="mono text-[10px] tracking-[0.1em] text-(--color-faint)">{text}</span>
    : null;
}

function Empty({ shown }: { shown: boolean }) {
  const t = useTranslations('adminPages.listEditor');
  return shown ? (
    <div className="mono text-[11px] text-(--color-faint) border border-dashed border-(--color-rule) px-4 py-3 rounded-sm">
      {t('empty')}
    </div>
  ) : null;
}

function ListRow({
  idx, count, child, onMove, onRemove,
}: {
  idx: number; count: number; child: ReactNode;
  onMove: (delta: number) => void; onRemove: () => void;
}) {
  return (
    <div className="border border-(--color-rule) rounded-sm p-4 bg-(--color-surface)/40">
      <RowControls idx={idx} count={count} onMove={onMove} onRemove={onRemove} />
      <div>{child}</div>
    </div>
  );
}

function RowControls({
  idx, count, onMove, onRemove,
}: {
  idx: number; count: number;
  onMove: (delta: number) => void; onRemove: () => void;
}) {
  const t = useTranslations('adminPages.listEditor');
  return (
    <div className="flex items-baseline justify-between mb-2">
      <span className="mono text-[9.5px] tracking-[0.18em] uppercase text-(--color-faint) tabular-nums">
        {String(idx + 1).padStart(2, '0')}
      </span>
      <div className="flex items-center gap-2 mono text-[10px] tracking-[0.1em] text-(--color-muted)">
        <button type="button" onClick={() => onMove(-1)} disabled={idx === 0} className="hover:text-(--color-ink) disabled:opacity-30">↑</button>
        <button type="button" onClick={() => onMove(1)} disabled={idx === count - 1} className="hover:text-(--color-ink) disabled:opacity-30">↓</button>
        <button type="button" onClick={onRemove} className="text-(--color-faint) hover:text-(--color-accent) ml-1">{t('remove')}</button>
      </div>
    </div>
  );
}

function addItem<T>(p: Props<T>): void {
  p.onChange([...p.items, p.render.empty()]);
}
function patchItem<T>(p: Props<T>, i: number, patch: Partial<T>): void {
  p.onChange(p.items.map((x, j) => j === i ? { ...x, ...patch } : x));
}
function removeItem<T>(p: Props<T>, i: number): void {
  p.onChange(p.items.filter((_, j) => j !== i));
}
function moveItem<T>(p: Props<T>, i: number, delta: number): void {
  const j = i + delta;
  (j < 0 || j >= p.items.length) || swapItems(p, i, j);
}
function swapItems<T>(p: Props<T>, i: number, j: number): void {
  const next = [...p.items];
  const tmp = next[i]!;
  next[i] = next[j]!;
  next[j] = tmp;
  p.onChange(next);
}
