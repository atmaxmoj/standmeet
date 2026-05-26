// CrosslinkPicker —— `[[…]]` autocomplete 下拉。tippy 浮窗承载。
// 键盘 ↑↓ Enter 由 picker 自己吞；其它键 false 让 Tiptap 继续处理。

'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from 'react';

import { handlePickerKey } from '@/lib/blog/crosslink-picker-keys';
import type { PostSlugEntry } from '@/lib/blog/post-slug-index';

export interface CrosslinkPickerRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface Props {
  query: string;
  items: readonly PostSlugEntry[];
  command: (entry: PostSlugEntry) => void;
}

export const CrosslinkPicker = forwardRef<CrosslinkPickerRef, Props>(function CrosslinkPicker(
  { query, items, command }, ref,
) {
  const [selected, setSelected] = useState(0);
  useEffect(() => setSelected(0), [items]);
  useImperativeHandle(ref, () => ({
    onKeyDown: (e) => handlePickerKey(e, { items, selected, setSelected, command }),
  }));

  return (
    <div
      role="listbox"
      data-testid="crosslink-picker"
      className="sm-crosslink-picker"
    >
      <Header query={query} />
      <Body items={items} selected={selected} onPick={command} onHover={setSelected} />
      <Footer />
    </div>
  );
});

function Body({
  items, selected, onPick, onHover,
}: {
  items: readonly PostSlugEntry[];
  selected: number;
  onPick: (e: PostSlugEntry) => void;
  onHover: (i: number) => void;
}) {
  return items.length === 0 ? <EmptyHint /> : (
    <List items={items} selected={selected} onPick={onPick} onHover={onHover} />
  );
}

function Header({ query }: { query: string }) {
  return (
    <div className="sm-smallcaps px-3.5 pt-2 pb-1">
      cross-link
      <span className="text-(--color-faint) ml-2">[[{query}]]</span>
    </div>
  );
}

function EmptyHint() {
  return (
    <div className="px-3.5 py-2 mono text-[11px] text-(--color-faint)">
      no match · type a slug to create
    </div>
  );
}

function List({
  items, selected, onPick, onHover,
}: {
  items: readonly PostSlugEntry[];
  selected: number;
  onPick: (e: PostSlugEntry) => void;
  onHover: (i: number) => void;
}) {
  return (
    <ul className="py-1">
      {items.map((e, i) => (
        <Row
          key={e.slug} entry={e}
          active={i === selected}
          onPick={() => onPick(e)}
          onHover={() => onHover(i)}
        />
      ))}
    </ul>
  );
}

function Row({
  entry, active, onPick, onHover,
}: {
  entry: PostSlugEntry;
  active: boolean;
  onPick: () => void;
  onHover: () => void;
}) {
  return (
    <li>
      <button
        type="button" onClick={onPick} onMouseEnter={onHover}
        data-testid={`crosslink-item-${entry.slug}`}
        className={`sm-crosslink-row ${active ? 'is-active' : ''}`}
      >
        <span className="sm-crosslink-row-mark">[[</span>
        <span className="sm-crosslink-row-title">{entry.title}</span>
        <span className="sm-crosslink-row-slug">{entry.slug}</span>
      </button>
    </li>
  );
}

function Footer() {
  return (
    <div className="px-3.5 py-1.5 border-t border-(--color-rule) flex items-baseline justify-between">
      <span className="mono text-[9.5px] text-(--color-faint) tracking-[0.04em]">
        ↑↓ navigate · ↵ insert · esc to cancel
      </span>
    </div>
  );
}
