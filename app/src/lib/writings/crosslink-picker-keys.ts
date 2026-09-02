// crosslink-picker-keys — keyboard control flow for CrosslinkPicker.
// The presentation layer bans `if` / complexity > 3, so this is pulled
// out into lib/.

import type { PostSlugEntry } from '@/lib/writings/post-slug-index';

interface Ctx {
  items: readonly PostSlugEntry[];
  selected: number;
  setSelected: (i: number) => void;
  command: (entry: PostSlugEntry) => void;
}

export function handlePickerKey(e: KeyboardEvent, ctx: Ctx): boolean {
  const handler = KEY_HANDLERS[e.key];
  return handler ? handler(ctx) : false;
}

const KEY_HANDLERS: Record<string, (ctx: Ctx) => boolean> = {
  ArrowDown: ({ items, selected, setSelected }) => {
    setSelected(wrap(selected + 1, items.length));
    return true;
  },
  ArrowUp: ({ items, selected, setSelected }) => {
    setSelected(wrap(selected - 1, items.length));
    return true;
  },
  Enter: ({ items, selected, command }) => {
    const pick = items[selected];
    pick && command(pick);
    return true;
  },
};

function wrap(n: number, len: number): number {
  const m = Math.max(1, len);
  return ((n % m) + m) % m;
}
