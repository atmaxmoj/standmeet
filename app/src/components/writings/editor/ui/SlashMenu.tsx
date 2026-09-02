// SlashMenu —— slash menu UI. tippy.js takes the ProseMirror coord → positions
// the floating popup. Keyboard ↑↓ Enter Esc are forwarded from the
// slash-command extension's onKeyDown to selectByIndex (exposed via
// imperativeHandle).
//
// Design language: mono labels + cream paper + ink + vermillion, no rounded
// corners / no shadow / same look as the other admin lists.

'use client';

import { forwardRef, useCallback, useImperativeHandle, useState } from 'react';
import { useTranslations } from 'next-intl';

import type { SlashItem } from '@/components/writings/editor/slash-items';

export interface SlashMenuRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface Props {
  items: SlashItem[];
  command: (item: SlashItem) => void;
}

// keyHandlers —— key name → action. Gives keydown a lookup instead of a
// chained ternary, to keep complexity at 1.
type KeyAction = (ctx: KeyContext) => boolean;
interface KeyContext {
  items: SlashItem[];
  active: number;
  setActive: (n: number) => void;
  select: (n: number) => void;
}

const keyHandlers: Record<string, KeyAction> = {
  ArrowUp: (c) => { c.setActive((c.active + c.items.length - 1) % c.items.length); return true; },
  ArrowDown: (c) => { c.setActive((c.active + 1) % c.items.length); return true; },
  Enter: (c) => { c.select(c.active); return true; },
};

export const SlashMenu = forwardRef<SlashMenuRef, Props>(function SlashMenu(
  { items, command }, ref,
) {
  const [active, setActive] = useState(0);

  const select = useCallback((idx: number) => {
    const item = items[idx];
    item && command(item);
  }, [items, command]);

  useImperativeHandle(ref, () => ({
    onKeyDown: (event: KeyboardEvent) => dispatchKey(event, { items, active, setActive, select }),
  }), [items, active, select]);

  return (
    <div
      className="bg-(--color-paper) border border-(--color-rule) shadow-lg flex flex-col py-1 min-w-[260px] max-h-[320px] overflow-y-auto"
      data-testid="slash-menu"
    >
      {items.length === 0 ? <Empty /> : <Rows items={items} active={active} setActive={setActive} select={select} />}
    </div>
  );
});

function dispatchKey(event: KeyboardEvent, ctx: KeyContext): boolean {
  const handler = keyHandlers[event.key];
  return handler ? handler(ctx) : false;
}

function Rows({
  items, active, setActive, select,
}: { items: SlashItem[]; active: number; setActive: (n: number) => void; select: (n: number) => void }) {
  return (
    <>
      {items.map((it, i) => (
        <SlashRow
          key={it.id} item={it} active={i === active}
          onClick={() => select(i)}
          onMouseEnter={() => setActive(i)}
        />
      ))}
    </>
  );
}

function Empty() {
  const t = useTranslations('writings.editor');
  return (
    <div className="px-3 py-2 mono text-[11px] text-(--color-muted)">{t('slashNoMatch')}</div>
  );
}

function SlashRow({
  item, active, onClick, onMouseEnter,
}: {
  item: SlashItem; active: boolean; onClick: () => void; onMouseEnter: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      data-testid={`slash-item-${item.id}`}
      className={`text-left px-3 py-2 flex items-baseline gap-3 ${active ? 'bg-(--color-ink) text-(--color-paper)' : 'text-(--color-ink) hover:bg-(--color-rule)/40'}`}
    >
      <span className="font-serif text-[14px] flex-1">{item.title}</span>
      <span className={`mono text-[10px] ${active ? 'text-(--color-paper)/70' : 'text-(--color-faint)'}`}>
        {item.hint}
      </span>
    </button>
  );
}
