// EditOverlays —— click-to-edit on the rendered résumé (docs/design/composer-visual-editor.md,
// Phase 3). For each editable field the template anchored (edit-anchor → useTypstPreview anchors),
// a small ✎ hotspot sits at that field's position; clicking it opens an inline editor there,
// prefilled with the field's value. Committing writes the field back to the draft, which recompiles
// the preview — WYSIWYG, editing on the document itself. Content stays structured (the field's value
// is placed, never eval'd) exactly like the form path.

'use client';

import { useState } from 'react';

import { isEditableField } from '@/lib/admin/draft-model';
import { anchorToPx, type SvgGeo } from '@/lib/admin/use-svg-geometry';
import type { EditAnchor } from '@/lib/admin/typst-preview';

interface Props {
  anchors: readonly EditAnchor[];
  geo: SvgGeo;
  getValue: (field: string) => string;
  onEdit: (field: string, value: string) => void;
}

export function EditOverlays({ anchors, geo, getValue, onEdit }: Props) {
  const [editing, setEditing] = useState('');
  // MVP: page-1 fields the canvas editor supports; others render in the preview but aren't hotspots.
  const editable = anchors.filter((a) => a.page === 1 && isEditableField(a.field));
  return (
    <>
      {editable.map((a) => (
        editing === a.field
          ? (
            <InlineEditor
              key={a.field} field={a.field} pos={anchorToPx(geo, a.x, a.y, a.page)}
              width={geo.width * 0.6} initial={getValue(a.field)}
              onCommit={(v) => { onEdit(a.field, v); setEditing(''); }}
              onCancel={() => setEditing('')}
            />
          )
          : (
            <Hotspot
              key={a.field} field={a.field} pos={anchorToPx(geo, a.x, a.y, a.page)}
              onOpen={() => setEditing(a.field)}
            />
          )
      ))}
    </>
  );
}

function Hotspot({
  field, pos, onOpen,
}: { field: string; pos: { x: number; y: number }; onOpen: () => void }) {
  return (
    <button
      type="button"
      data-testid={`composer-edit-hotspot-${field}`}
      aria-label={`edit ${field}`}
      onClick={onOpen}
      className="absolute sm-z-raised-1 -translate-x-full -translate-y-1/2 mono text-[11px] leading-none px-1 py-0.5 rounded-[2px] bg-(--color-accent) text-(--color-paper) opacity-70 hover:opacity-100 cursor-pointer"
      // eslint-disable-next-line no-restricted-syntax -- runtime px from the measured SVG geometry
      style={{ left: pos.x, top: pos.y }}
    >
      {'✎'}
    </button>
  );
}

function InlineEditor({
  field, pos, width, initial, onCommit, onCancel,
}: {
  field: string;
  pos: { x: number; y: number };
  width: number;
  initial: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  return (
    <textarea
      autoFocus
      data-testid={`composer-edit-input-${field}`}
      value={text}
      onChange={(e) => setText(e.target.value)}
      // Blur commits (click away / tab out); Escape cancels. Plain Enter stays a newline.
      onBlur={() => onCommit(text)}
      onKeyDown={(e) => (e.key === 'Escape' ? onCancel() : undefined)}
      className="absolute sm-z-raised-2 sm-field-input sm-reading resize p-1 text-[12px] shadow-lg"
      // eslint-disable-next-line no-restricted-syntax -- runtime px from the measured SVG geometry
      style={{ left: pos.x, top: pos.y, width, minHeight: 48 }}
    />
  );
}
