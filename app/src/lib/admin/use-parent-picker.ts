// use-parent-picker —— the "set parent" dropdown's own view of a corpus list: the newest page,
// narrowed on the server as the owner types (docs/design/paging.md, *Pickers*). It used to list
// the section's loaded rows, so an entry older than one page could never become a parent.

'use client';

import { useState } from 'react';
import { z } from 'zod';

import { createPagedStore, usePaged, type PagedStore } from '@/lib/state/create-paged-store';

const ParentRowSchema = z.object({
  id: z.string(), title: z.string(), path: z.string().nullish(),
});
type ParentRow = z.infer<typeof ParentRowSchema>;

export interface ParentOption { id: string; label: string }

export interface ParentPicker {
  options: ParentOption[];
  query: string;
  setQuery: (q: string) => void;
}

export interface ParentPickerOpts {
  // exclude —— the entry being edited: it cannot be its own parent.
  exclude?: string;
  // current —— the parent already set. Kept as an option when it is not on the loaded page, so
  // the select still shows it and a save does not move the entry to the root (F-L-28).
  current?: ParentOption;
  // labelBy —— 'path' (default): a corpus entry's address, which tells same-titled entries in
  // different branches apart. 'title': a writing's path is writings/<slug>, not its tree address.
  labelBy?: 'path' | 'title';
}

// useParentPicker —— listPath is the genre's list (/corpus/wiki, /writings/).
export function useParentPicker(listPath: string, opts: ParentPickerOpts = {}): ParentPicker {
  const [store] = useState<PagedStore<ParentRow>>(() => createPagedStore({
    name: 'parent-picker', path: listPath, item: ParentRowSchema, params: { q: '' },
  }));
  const page = usePaged(store);
  return {
    options: parentOptions(page.items, opts),
    query: page.params.q ?? '',
    setQuery: (q) => page.setParams({ q }),
  };
}

// currentParent —— the parent already set ('' = root, none) as the option to keep.
export function currentParent(id: string, label: string): ParentOption | undefined {
  return id === '' ? undefined : { id, label };
}

function parentOptions(rows: readonly ParentRow[], opts: ParentPickerOpts): ParentOption[] {
  const listed = rows
    .filter((r) => r.id !== opts.exclude)
    .map((r) => ({ id: r.id, label: opts.labelBy === 'title' ? r.title : (r.path || r.title) }));
  const current = opts.current;
  return current && !listed.some((o) => o.id === current.id) ? [current, ...listed] : listed;
}
