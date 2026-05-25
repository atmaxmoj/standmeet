// slash-command.ts —— Tiptap suggestion extension：触发字符 `/`，下拉
// 列表 = filterItems(query)，命中 → 调 item.insert(editor, range)。
//
// tippy.js 接 ProseMirror clientRect (用户输 `/` 的光标位置)，浮窗
// 跟随。SlashMenu React 组件用 reactRenderer 挂载。
//
// 设计：extension 只负责"接 suggestion API + 调度 menu"，菜单条目本身
// 全在 slash-items.ts。加新 block 类型不动这层。

import { Extension } from '@tiptap/core';
import type { Editor, Range } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import type { SuggestionOptions, SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion';
import { ReactRenderer } from '@tiptap/react';
import tippy from 'tippy.js';
import type { Instance as TippyInstance } from 'tippy.js';

import { filterItems, type SlashItem } from '@/components/blog/editor/slash-items';
import { SlashMenu, type SlashMenuRef } from '@/components/blog/editor/ui/SlashMenu';

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

// items() 必须返一个能被 command props 收到的形态。我们把 SlashItem 自己
// 当 item，并在每条上挂 `insert`（已经在 SlashItem 上有）。Suggestion 的
// props 类型即 SlashCommandProps，把 insert 桥过去。
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
  return clientRect
    ? (tippy('body', {
        getReferenceClientRect: clientRect as () => DOMRect,
        appendTo: () => document.body,
        content,
        showOnCreate: true,
        interactive: true,
        trigger: 'manual',
        placement: 'bottom-start',
      })[0] ?? null)
    : null;
}

function updateMenu(
  state: SlashStorage, props: SuggestionProps<SlashItem, SlashCommandProps>,
): void {
  state.renderer?.updateProps({ items: props.items, command: props.command });
  props.clientRect && state.popup?.setProps({
    getReferenceClientRect: props.clientRect as () => DOMRect,
  });
}

function destroyMenu(state: SlashStorage): void {
  state.popup?.destroy();
  state.renderer?.destroy();
  state.popup = null;
  state.renderer = null;
}
