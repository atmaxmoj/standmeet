// crosslink-command —— Tiptap suggestion extension: `[[`, picker, insert
// `[[slug]]` 字面 on pick。Crosslink rewrite at render-time handled by
// backend usecase (post_links + RewriteCrossLinksForRender)。
//
// 这一版从 v1 改成 mark-based char `[`（单字符）+ allowSpaces false + items
// 同步读 indexCache，避免 prod build 下用 multi-char `[[` 触发 Suggestion
// regex 编译或 async items 解 unbox 出问题。第二个 `[` 由用户继续打字
// 进入 query；当 query 以 `]` 收尾时让 picker dismissExit。

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

// 不同的 PluginKey 是关键 —— BlogEditor 同时挂 SlashCommand 和这个
// CrosslinkCommand，两个 Suggestion 插件如果用同一 default key 会在
// ProseMirror plugins set 里撞 key，editor mount 直接 throw（prod build
// 下整页崩成 "Application error"）。
const CROSSLINK_PLUGIN_KEY = new PluginKey('crosslinkSuggestion');

import {
  CrosslinkPicker,
  type CrosslinkPickerRef,
} from '@/components/blog/editor/ui/CrosslinkPicker';
import {
  fetchAdminPostSlugs,
  filterSlugs,
  type PostSlugEntry,
} from '@/lib/blog/post-slug-index';

type Opt = Omit<SuggestionOptions<PostSlugEntry, ItemProps>, 'editor'>;

interface ItemProps { insert: (editor: Editor, range: Range) => void }

interface Storage {
  renderer: ReactRenderer<CrosslinkPickerRef> | null;
  popup: TippyInstance | null;
}

// 单例 cache。primeIndex 是 fire-and-forget；items 同步读，初次没装好就
// 空数组（picker 显示 no match）。
let indexCache: readonly PostSlugEntry[] = [];

function primeIndex(): void {
  if (typeof window === 'undefined') return;
  void fetchAdminPostSlugs()
    .then((rows) => { indexCache = rows; })
    .catch(() => { /* silent: picker 仍可用 */ });
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

// 用单字符 `[` 做 trigger，第二个 `[` 自然走 query 第一个字符。query 真起
// 来时第一个 char 必为 `[`（用户输入"[[ "中的第二个"["）。items 过滤前用
// query.replace(/^\[/, '') 把"占位 [" 去掉。这样既绕开 multi-char trigger
// 在 v3 下的不稳，也不影响 picker 用户体验。
function defaultOptions(): Opt {
  return {
    char: '[',
    startOfLine: false,
    allowSpaces: true,
    pluginKey: CROSSLINK_PLUGIN_KEY,
    // query 第一个 char 必为 '[' 才视作 crosslink 触发（防误触：单 `[` 不弹）
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
