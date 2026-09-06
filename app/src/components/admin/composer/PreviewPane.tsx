// PreviewPane —— the composer's right side. Two views of the SAME draft under the SAME template:
//
//   - "live"  — an in-browser typst.ts (WASM) render (use-typst-preview), recompiled as the owner
//     types. Instant, no server round-trip; the foundation for on-canvas editing.
//   - "pdf"   — the authoritative server render (GET /drafts/{id}/preview.pdf) in an <iframe>, the
//     exact bytes commit will produce.
//
// The committed PDF is always the server's; the WASM view is preview/edit only (its QR is a fixed
// placeholder). If the WASM can't load or compile, the pane falls back to the PDF view on its own,
// so the preview is never blank. The template picker changes both views.

'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { SelectField } from '@/components/atoms/SelectField';
import { EditOverlays } from '@/components/admin/composer/EditOverlays';
import { previewURL } from '@/lib/admin/save-draft';
import { useTypstPreview } from '@/lib/admin/use-typst-preview';
import { useSvgGeometry } from '@/lib/admin/use-svg-geometry';
import type { EditAnchor } from '@/lib/admin/typst-preview';

import styles from '@/components/admin/composer/PreviewPane.module.css';

interface Props {
  draftID: string;
  template: string;
  version: number;
  templates: readonly string[];
  fileName: string;
  onTemplate: (t: string) => void;
  // live-preview inputs (the current, unsaved model — so the WASM view is instant)
  dataJSON: string;
  role: string;
  company: string;
  qrURL: string; // the real code URL the QR carries (from the code picker)
  // Phase 3 on-canvas editing: read a field's value + write an edit back to the draft.
  fieldValue: (field: string) => string;
  onEditField: (field: string, value: string) => void;
}

type View = 'live' | 'pdf';

// resolveView —— which view actually shows: honour the owner's pick, but auto-fall back to the
// authoritative PDF when the WASM can't render. Extracted so the component stays under the
// presentation-layer complexity cap.
function resolveView(view: View, status: string): View {
  return view === 'live' && status !== 'failed' ? 'live' : 'pdf';
}

export function PreviewPane(props: Props) {
  const [view, setView] = useState<View>('live');
  const { svg, anchors, status } = useTypstPreview({
    template: props.template, dataJSON: props.dataJSON,
    role: props.role, company: props.company, qrURL: props.qrURL, enabled: view === 'live',
  });
  const effective = resolveView(view, status);
  return (
    <div className={styles.preview}>
      <PreviewToolbar
        fileName={props.fileName} template={props.template}
        templates={props.templates} onTemplate={props.onTemplate}
        view={view} onView={setView} failed={status === 'failed'}
      />
      <div className={styles.frameWrap}>
        {effective === 'live'
          ? (
            <LiveView
              svg={svg} status={status} anchors={anchors}
              fieldValue={props.fieldValue} onEditField={props.onEditField}
            />
          )
          : (
            <iframe
              title="resume preview"
              data-testid="composer-preview-frame"
              src={previewURL(props.draftID, props.version)}
              className={styles.frame}
            />
          )}
      </div>
    </div>
  );
}

// LiveView —— the WASM-rendered SVG plus the on-canvas edit overlays. The SVG is typst's own output
// (résumé text placed as content, never eval'd — same injection-safety as the PDF path), so
// injecting it is safe.
function LiveView({
  svg, status, anchors, fieldValue, onEditField,
}: {
  svg: string;
  status: string;
  anchors: readonly EditAnchor[];
  fieldValue: (field: string) => string;
  onEditField: (field: string, value: string) => void;
}) {
  const t = useTranslations('adminShell.previewPane');
  const wrapRef = useRef<HTMLDivElement>(null);
  const geo = useSvgGeometry(wrapRef, svg);
  return svg === ''
    ? <div className={styles.livePending} data-testid="composer-preview-svg">{t('rendering')}</div>
    : (
      <div
        ref={wrapRef}
        className={styles.liveSvg}
        data-testid="composer-preview-svg"
        data-status={status}
      >
        {/* typst's own SVG output — content placed, never eval'd (same injection-safety as the PDF) */}
        <div className={styles.liveSvgInner} dangerouslySetInnerHTML={{ __html: svg }} />
        {geo === null ? null : (
          <EditOverlays anchors={anchors} geo={geo} getValue={fieldValue} onEdit={onEditField} />
        )}
      </div>
    );
}

function PreviewToolbar({
  fileName, template, templates, onTemplate, view, onView, failed,
}: {
  fileName: string;
  template: string;
  templates: readonly string[];
  onTemplate: (t: string) => void;
  view: View;
  onView: (v: View) => void;
  failed: boolean;
}) {
  const t = useTranslations('adminShell.previewPane');
  return (
    <div className={styles.toolbar}>
      <span className={styles.fileName} title={fileName}>
        {t('fileName', { name: fileName })}
      </span>
      <div className={styles.right}>
        <ViewToggle view={view} onView={onView} failed={failed} />
        <TemplatePicker template={template} templates={templates} onTemplate={onTemplate} />
      </div>
    </div>
  );
}

// ViewToggle —— live (WASM) vs pdf (server). Hidden implementation words stay out of it; the labels
// are the two view names. When WASM failed the live button is disabled (the pane already fell back).
function ViewToggle({
  view, onView, failed,
}: { view: View; onView: (v: View) => void; failed: boolean }) {
  return (
    <div className={styles.viewToggle}>
      <button
        type="button" data-testid="composer-preview-view-live"
        aria-pressed={view === 'live'} disabled={failed}
        className={view === 'live' ? styles.viewOn : styles.viewOff}
        onClick={() => onView('live')}
      >
        {'live'}
      </button>
      <button
        type="button" data-testid="composer-preview-view-pdf"
        aria-pressed={view === 'pdf'}
        className={view === 'pdf' ? styles.viewOn : styles.viewOff}
        onClick={() => onView('pdf')}
      >
        {'pdf'}
      </button>
    </div>
  );
}

// TemplatePicker —— the Typst layout both views use. aria-label carries the meaning (an attribute,
// exempt from the literal-string rule); the option text is the layout names themselves.
function TemplatePicker({
  template, templates, onTemplate,
}: {
  template: string;
  templates: readonly string[];
  onTemplate: (t: string) => void;
}) {
  return (
    <SelectField
      aria-label="résumé template"
      testid="composer-template-picker"
      value={template === '' ? (templates[0] ?? '') : template}
      onChange={(e) => onTemplate(e.target.value)}
      mono
    >
      {templates.map((tp) => <option key={tp} value={tp}>{tp}</option>)}
    </SelectField>
  );
}
