// BlockConfigForm — one form, every block.
//
// `docs/design/plugin/frontend.md` §2: *"a block declares its settings; the admin renders
// them generically."* **No block's name appears in this file**, and that is the test —
// `CalendarBookingPolicy` was a hand-written form for one block's settings, and it drifted
// from the sandboxed copy of the same policy until the host said 18:00 and the sandbox
// used 17:00. A form rendered from the declaration cannot drift from it.
//
// One renderer covers everything because a type, a label and a range are all a form
// needs. A field type this does not recognise falls back to a text box rather than
// refusing to render: the owner can still read and set the value, and adding a new field
// type stays a manifest change rather than a frontend release.

'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import {
  useBlockConfig, inputType, asInputValue, editedValues,
  type ConfigField,
} from '@/lib/admin/use-block-config';
import { useAction } from '@/lib/ui/use-action';
import { useReportError } from '@/lib/ui/use-report-error';

export function BlockConfigForm({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useTranslations('adminIntegrations.blocks');
  const cfg = useBlockConfig();
  const { load } = cfg;
  const report = useReportError();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const run = useAction();

  // Report a failed read instead of swallowing it. `void load(id)` on its own leaves an
  // empty form on screen, which the owner reads as "this block has no settings" — the
  // one answer that is never true here, since a block without settings has no form to
  // open. The error surfacing is what turns that into something anyone can act on.
  useEffect(() => { load(id).catch(report); }, [load, id, report]);

  const valueOf = (f: ConfigField): string =>
    edits[f.key] ?? asInputValue(f.value);

  return (
    <div
      className="mt-2 border border-(--color-rule)/60 rounded-sm p-3"
      data-testid={`block-config-${id}`}
    >
      <div className="space-y-3">
        {cfg.fields.map((f) => (
          <Field
            key={f.key}
            field={f}
            value={valueOf(f)}
            onChange={(v) => setEdits((e) => ({ ...e, [f.key]: v }))}
          />
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          data-testid="block-config-save"
          onClick={() => {
            void run(() => cfg.save(id, editedValues(cfg.fields, edits)),
              { success: t('savedToast') }).then(() => setEdits({}));
          }}
          className="px-3 py-1.5 mono text-xs border border-(--color-accent)
                     text-(--color-accent) rounded-sm hover:bg-(--color-accent)/10"
        >
          {t('save')}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="mono text-[10px] text-(--color-muted) hover:text-(--color-accent)"
        >
          {t('close')}
        </button>
      </div>
    </div>
  );
}

function Field(
  { field, value, onChange }:
  { field: ConfigField; value: string; onChange: (v: string) => void },
) {
  return (
    <label className="block">
      <span className="mono text-[11px] text-(--color-ink)">{field.label}</span>
      {field.description !== undefined && field.description !== '' && (
        <span className="block mono text-[10px] text-(--color-muted)">{field.description}</span>
      )}
      <input
        data-testid={`block-config-field-${field.key}`}
        type={inputType(field.type)}
        value={value}
        min={field.min}
        max={field.max}
        onChange={(e) => onChange(e.target.value)}
        className="sm-field-input sm-mono mt-1 w-full"
      />
    </label>
  );
}
