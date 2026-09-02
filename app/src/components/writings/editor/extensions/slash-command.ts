// slash-command.ts — Tiptap suggestion extension: trigger character `/`,
// dropdown list = filterItems(query), on match → call item.insert(editor, range).
//
// tippy.js reads the ProseMirror clientRect (cursor position where the
// user typed `/`), and the popup follows it. The SlashMenu React component
// mounts via reactRenderer.
//
// Design: the extension only handles "wire up the suggestion API + drive
// the menu"; the menu items themselves all live in slash-items.ts. Adding
// a new block type doesn't touch this layer.

import { Extension } from '@tiptap/core';
import type { Editor, Range } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import type { SuggestionOptions, SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion';
import { ReactRenderer } from '@tiptap/react';
import tippy from 'tippy.js';
import type { Instance as TippyInstance } from 'tippy.js';

import { filterItems, type SlashItem } from '@/components/writings/editor/slash-items';
import { SlashMenu, type SlashMenuRef } from '@/components/writings/editor/ui/SlashMenu';

type SlashSuggestionOptions = Omit<SuggestionOptions<SlashItem, SlashCommandProps>, 'editor'>;

interface SlashCommandProps { insert: (editor: Editor, range: Range) => void }

interface SlashStorage {
  renderer: ReactRenderer<SlashMenuRef> | null;
  popup: TippyInstance | null;
}

export const SlashCommand = Extension.create<{ suggestion: SlashSuggestionOptions }>({
  name: 'slashCommand',

  addOptions() {
    return { suggestion: defaultSuggestionOptions() };
  },

  addProseMirrorPlugins() {
    return [Suggestion({ editor: this.editor, ...this.options.suggestion })];
  },
});

function defaultSuggestionOptions(): SlashSuggestionOptions {
  return {
    char: '/',
    startOfLine: false,
    allowSpaces: false,
    items: ({ query }) => filterItems(query).map(toSuggestionItem),
    command: ({ editor, range, props }) => props.insert(editor, range),
    render: renderSuggestion,
  };
}

// items() must return a shape the command props can receive. We use
// SlashItem itself as the item, with `insert` attached on each entry
// (already present on SlashItem). Suggestion's props type is
// SlashCommandProps, which bridges insert through.
function toSuggestionItem(item: SlashItem): SlashItem & SlashCommandProps {
  return { ...item, insert: item.insert };
}

function renderSuggestion() {
  const state: SlashStorage = { renderer: null, popup: null };
  return {
    onStart: (props: SuggestionProps<SlashItem, SlashCommandProps>) => mountMenu(state, props),
    onUpdate: (props: SuggestionProps<SlashItem, SlashCommandProps>) => updateMenu(state, props),
    onKeyDown: (props: SuggestionKeyDownProps) =>
      state.renderer?.ref?.onKeyDown(props.event) ?? false,
    onExit: () => destroyMenu(state),
  };
}

function mountMenu(
  state: SlashStorage, props: SuggestionProps<SlashItem, SlashCommandProps>,
): void {
  state.renderer = new ReactRenderer(SlashMenu, {
    props: { items: props.items, command: props.command },
    editor: props.editor,
  });
  state.popup = createPopup(state.renderer.element, props.clientRect);
}

function createPopup(
  content: Element, clientRect: SuggestionProps<SlashItem, SlashCommandProps>['clientRect'],
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
  state: SlashStorage, props: SuggestionProps<SlashItem, SlashCommandProps>,
): void {
  state.renderer?.updateProps({ items: props.items, command: props.command });
  if (props.clientRect) {
    const fn = props.clientRect;
    state.popup?.setProps({ getReferenceClientRect: () => fn() ?? new DOMRect() });
  }
}

function destroyMenu(state: SlashStorage): void {
  state.popup?.destroy();
  state.renderer?.destroy();
  state.popup = null;
  state.renderer = null;
}
