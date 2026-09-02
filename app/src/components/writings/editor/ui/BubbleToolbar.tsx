// BubbleToolbar —— shows a floating B / I / S / code / link popup on selection.
// Tiptap selection changes → recompute coord → follow.
//
// MVP: the link button uses window.prompt to get the URL; future work will
// wire up an inline popover.

'use client';

import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';

import { cssVars } from '@/lib/ui/css-vars';

interface Props { editor: Editor | null }

interface Pos { top: number; left: number; visible: boolean }

const hiddenPos: Pos = { top: 0, left: 0, visible: false };

export function BubbleToolbar({ editor }: Props) {
  const pos = useSelectionPos(editor);
  return editor && pos.visible
    ? <ToolbarBody editor={editor} pos={pos} />
    : null;
}

function useSelectionPos(editor: Editor | null): Pos {
  const [pos, setPos] = useState<Pos>(hiddenPos);
  useEffect(() => {
    const update = () => setPos(computePos(editor));
    const hide = () => setPos(hiddenPos);
    editor?.on('selectionUpdate', update);
    editor?.on('blur', hide);
    return () => {
      editor?.off('selectionUpdate', update);
      editor?.off('blur', hide);
    };
  }, [editor]);
  return pos;
}

function computePos(editor: Editor | null): Pos {
  return !editor || editor.state.selection.empty
    ? hiddenPos
    : selectionRectPos(editor);
}

function selectionRectPos(editor: Editor): Pos {
  const { from, to } = editor.state.selection;
  const startCoord = editor.view.coordsAtPos(from);
  const endCoord = editor.view.coordsAtPos(to);
  return {
    top: startCoord.top - 44 + window.scrollY,
    left: (startCoord.left + endCoord.right) / 2 + window.scrollX,
    visible: true,
  };
}

function ToolbarBody({ editor, pos }: { editor: Editor; pos: Pos }) {
  return (
    // Coordinates go through `style`, not a computed class name: a string like
    // `[--pos-top:${'${pos.top}'}px]` isn't seen by the Tailwind build scan,
    // so no CSS is generated for it, and `.sm-pos-abs` always falls back to
    // its default `top:0; left:0` — **this toolbar never actually follows
    // the selection**, it just sits at the top-left of its positioned
    // ancestor.
    <div
      data-testid="bubble-toolbar"
      // eslint-disable-next-line no-restricted-syntax -- the selection coords differ every time, only `style` can carry them
      style={cssVars({ '--pos-top': `${pos.top}px`, '--pos-left': `${pos.left}px` })}
      className="sm-pos-abs sm-z-float -translate-x-1/2 bg-(--color-ink) text-(--color-paper) flex items-baseline gap-1 px-1 py-0.5"
    >
      <BoldBtn editor={editor} />
      <ItalicBtn editor={editor} />
      <StrikeBtn editor={editor} />
      <CodeBtn editor={editor} />
      <LinkBtn editor={editor} />
    </div>
  );
}

interface BtnCtx { editor: Editor }

function BoldBtn({ editor }: BtnCtx) {
  return (
    <ToolBtn id="bold" label="B" variant=""
      active={editor.isActive('bold')}
      onClick={() => editor.chain().focus().toggleBold().run()} />
  );
}
function ItalicBtn({ editor }: BtnCtx) {
  return (
    <ToolBtn id="italic" label="I" variant="italic"
      active={editor.isActive('italic')}
      onClick={() => editor.chain().focus().toggleItalic().run()} />
  );
}
function StrikeBtn({ editor }: BtnCtx) {
  return (
    <ToolBtn id="strike" label="S" variant="line-through"
      active={editor.isActive('strike')}
      onClick={() => editor.chain().focus().toggleStrike().run()} />
  );
}
function CodeBtn({ editor }: BtnCtx) {
  return (
    <ToolBtn id="code" label="</>" variant="mono text-[11px]"
      active={editor.isActive('code')}
      onClick={() => editor.chain().focus().toggleCode().run()} />
  );
}
function LinkBtn({ editor }: BtnCtx) {
  return (
    <ToolBtn id="link" label="↗" variant=""
      active={editor.isActive('link')}
      onClick={() => promptLink(editor)} />
  );
}

function ToolBtn({
  id, label, variant, active, onClick,
}: {
  id: string; label: string; variant: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`bubble-${id}`}
      onClick={onClick}
      className={`px-2 py-1 text-[13px] hover:bg-(--color-accent) ${active ? 'bg-(--color-accent)' : ''} ${variant}`}
    >
      {label}
    </button>
  );
}

function promptLink(editor: Editor): void {
  const attrs: Record<string, unknown> = editor.getAttributes('link');
  const prev = typeof attrs['href'] === 'string' ? attrs['href'] : undefined;
  const url = window.prompt('URL', prev ?? 'https://');
  applyLink(editor, url);
}

function applyLink(editor: Editor, url: string | null): void {
  url === null
    ? void 0
    : url === ''
      ? void editor.chain().focus().unsetLink().run()
      : void editor.chain().focus().setLink({ href: url }).run();
}
