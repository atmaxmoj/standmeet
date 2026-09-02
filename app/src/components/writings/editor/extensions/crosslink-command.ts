// crosslink-command — Tiptap suggestion extension: `[[`, picker, insert
// `[[slug]]` literal on pick. Crosslink rewrite at render-time handled by
// backend usecase (writing_refs + RewriteCrossLinksForRender).
//
// This version switches from v1's mark-based char `[` (single char) +
// allowSpaces false + items reading indexCache synchronously, to avoid
// issues under prod build where a multi-char `[[` trigger hits Suggestion
// regex compilation or async items unboxing problems. The second `[` is
// typed by the user and enters the query naturally; when the query ends
// with `]`, the picker dismissExits.

import { Extension } from '@tiptap/core';
import type { Editor, Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import type {
  SuggestionOptions, SuggestionProps, SuggestionKeyDownProps,
} from '@tiptap/suggestion';
import { ReactRenderer } from '@tiptap/react';
import tippy from 'tippy.js';
import type { Instance as TippyInstance } from 'tippy.js';

// A distinct PluginKey is essential — WritingEditor mounts both SlashCommand
// and this CrosslinkCommand at the same time. If the two Suggestion plugins
// shared the same default key, they'd collide in the ProseMirror plugins
// set and editor mount would throw immediately (crashing the whole page
// into "Application error" under prod build).
const CROSSLINK_PLUGIN_KEY = new PluginKey('crosslinkSuggestion');

import {
  CrosslinkPicker,
  type CrosslinkPickerRef,
} from '@/components/writings/editor/ui/CrosslinkPicker';
import {
  fetchAdminPostSlugs,
  filterSlugs,
  type PostSlugEntry,
} from '@/lib/writings/post-slug-index';

type Opt = Omit<SuggestionOptions<PostSlugEntry, ItemProps>, 'editor'>;

interface ItemProps { insert: (editor: Editor, range: Range) => void }

interface Storage {
  renderer: ReactRenderer<CrosslinkPickerRef> | null;
  popup: TippyInstance | null;
}

// Singleton cache. primeIndex is fire-and-forget; items reads synchronously,
// so on first load before it's ready it's an empty array (picker shows no match).
let indexCache: readonly PostSlugEntry[] = [];

function primeIndex(): void {
  if (typeof window === 'undefined') return;
  void fetchAdminPostSlugs()
    .then((rows) => { indexCache = rows; })
    .catch(() => { /* silent: picker still usable */ });
}

export const CrosslinkCommand = Extension.create<{ suggestion: Opt }>({
  name: 'crosslinkCommand',

  addOptions() {
    return { suggestion: defaultOptions() };
  },

  addProseMirrorPlugins() {
    primeIndex();
    return [Suggestion({ editor: this.editor, ...this.options.suggestion })];
  },
});

// Uses the single char `[` as trigger; the second `[` naturally becomes the
// query's first character. Once the query actually starts, its first char
// must be `[` (the second "[" of the user's typed "[["). Before filtering
// items, query.replace(/^\[/, '') strips off that "placeholder [". This
// sidesteps the multi-char trigger's instability under v3, without
// affecting the picker's UX.
function defaultOptions(): Opt {
  return {
    char: '[',
    startOfLine: false,
    allowSpaces: true,
    pluginKey: CROSSLINK_PLUGIN_KEY,
    // The query's first char must be '[' to count as a crosslink trigger
    // (prevents accidental triggers: a lone `[` doesn't pop the picker)
    items: ({ query }) => {
      if (!query.startsWith('[')) return [];
      const real = query.slice(1);
      return filterSlugs(indexCache, real).map(toItem);
    },
    command: ({ editor, range, props }) => props.insert(editor, range),
    render: renderSuggestion,
  };
}

function toItem(entry: PostSlugEntry): PostSlugEntry & ItemProps {
  return {
    ...entry,
    insert: (editor, range) => {
      editor.chain().focus().insertContentAt(range, `[[${entry.slug}]] `).run();
    },
  };
}

function renderSuggestion() {
  const state: Storage = { renderer: null, popup: null };
  return {
    onStart: (p: SuggestionProps<PostSlugEntry, ItemProps>) => mountMenu(state, p),
    onUpdate: (p: SuggestionProps<PostSlugEntry, ItemProps>) => updateMenu(state, p),
    onKeyDown: (p: SuggestionKeyDownProps) =>
      state.renderer?.ref?.onKeyDown(p.event) ?? false,
    onExit: () => destroyMenu(state),
  };
}

function mountMenu(
  state: Storage, props: SuggestionProps<PostSlugEntry, ItemProps>,
): void {
  state.renderer = new ReactRenderer(CrosslinkPicker, {
    props: pickerProps(props),
    editor: props.editor,
  });
  state.popup = createPopup(state.renderer.element, props.clientRect);
}

function pickerProps(props: SuggestionProps<PostSlugEntry, ItemProps>) {
  return {
    query: props.query.replace(/^\[/, ''),
    items: props.items,
    command: (entry: PostSlugEntry) => props.command({ ...entry, insert: toItem(entry).insert }),
  };
}

function createPopup(
  content: Element,
  clientRect: SuggestionProps<PostSlugEntry, ItemProps>['clientRect'],
): TippyInstance | null {
  if (!clientRect) return null;
  const fn = clientRect;
  const getRect = () => fn() ?? new DOMRect();
  return tippy('body', {
    getReferenceClientRect: getRect,
    appendTo: () => document.body,
    content,
    showOnCreate: true,
    interactive: true,
    trigger: 'manual',
    placement: 'bottom-start',
  })[0] ?? null;
}

function updateMenu(
  state: Storage, props: SuggestionProps<PostSlugEntry, ItemProps>,
): void {
  state.renderer?.updateProps(pickerProps(props));
  if (props.clientRect) {
    const fn = props.clientRect;
    state.popup?.setProps({ getReferenceClientRect: () => fn() ?? new DOMRect() });
  }
}

function destroyMenu(state: Storage): void {
  state.popup?.destroy();
  state.renderer?.destroy();
  state.popup = null;
  state.renderer = null;
}
