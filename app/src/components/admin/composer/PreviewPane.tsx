// PreviewPane —— the composer's right side: the REAL Typst render of this draft (GET
// /drafts/{id}/preview.pdf), shown in an <iframe>. It reloads whenever `version` bumps (after a
// successful autosave), so what the owner sees is the persisted draft under the chosen template —
// not the old client-side <ResumePage> mock that could drift from what commit actually produced.
//
// The template picker lives here because changing it changes THIS view: pick classic/compact →
// the model's template updates → autosave → version bumps → the frame reloads under the new layout.

'use client';

import { useTranslations } from 'next-intl';

import { SelectField } from '@/components/atoms/SelectField';
import { previewURL } from '@/lib/admin/save-draft';

import styles from '@/components/admin/composer/PreviewPane.module.css';

interface Props {
  draftID: string;
  template: string;
  version: number;
  templates: readonly string[];
  fileName: string;
  onTemplate: (t: string) => void;
}

export function PreviewPane(props: Props) {
  return (
    <div className={styles.preview}>
      <PreviewToolbar
        fileName={props.fileName} template={props.template}
        templates={props.templates} onTemplate={props.onTemplate}
      />
      <div className={styles.frameWrap}>
        <iframe
          title="resume preview"
          data-testid="composer-preview-frame"
          src={previewURL(props.draftID, props.version)}
          className={styles.frame}
        />
      </div>
    </div>
  );
}

function PreviewToolbar({
  fileName, template, templates, onTemplate,
}: {
  fileName: string;
  template: string;
  templates: readonly string[];
  onTemplate: (t: string) => void;
}) {
  const t = useTranslations('adminShell.previewPane');
  return (
    <div className={styles.toolbar}>
      <span className={styles.fileName} title={fileName}>
        {t('fileName', { name: fileName })}
      </span>
      <div className={styles.right}>
        <TemplatePicker template={template} templates={templates} onTemplate={onTemplate} />
      </div>
    </div>
  );
}

// TemplatePicker —— the Typst layout the committed PDF uses. aria-label carries the meaning (an
// attribute, exempt from the literal-string rule); the option text is the layout names themselves.
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
