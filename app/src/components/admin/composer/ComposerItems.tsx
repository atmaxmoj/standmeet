// ComposerItems —— the per-row editors for ResumeComposer's repeatable sections (experience /
// education / social / custom). Split out of ComposerPanels for the 350-line file cap; the panels
// (in ComposerPanels) lay these out inside ReorderableRows.

'use client';

import { Field, RowHeader, SOCIAL_KINDS } from '@/components/admin/composer/ComposerAtoms';
import { SelectField } from '@/components/atoms/SelectField';
import type {
  DraftCustom,
  DraftEducation,
  DraftExperience,
  DraftSocial,
} from '@/lib/admin/draft-model';

type PatchExp = (id: string, p: Partial<DraftExperience>) => void;
type PatchEdu = (id: string, p: Partial<DraftEducation>) => void;
type PatchSoc = (id: string, p: Partial<DraftSocial>) => void;
type PatchCus = (id: string, p: Partial<DraftCustom>) => void;

export function ExperienceItem({
  exp, onPatch,
}: { exp: DraftExperience; onPatch: PatchExp }) {
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="org">
          <input
            type="text" value={exp.org}
            onChange={(e) => onPatch(exp.id, { org: e.target.value })}
            className="sm-field-input"
          />
        </Field>
        <Field label="role">
          <input
            type="text" value={exp.role}
            onChange={(e) => onPatch(exp.id, { role: e.target.value })}
            className="sm-field-input"
          />
        </Field>
        <Field label="from">
          <input
            type="text" value={exp.start} placeholder="YYYY-MM"
            data-testid={`composer-exp-from-${exp.id}`}
            onChange={(e) => onPatch(exp.id, { start: e.target.value })}
            className="sm-field-input sm-mono"
          />
        </Field>
        <Field label="to" hint="empty → present">
          <input
            type="text" value={exp.end} placeholder="present"
            data-testid={`composer-exp-to-${exp.id}`}
            onChange={(e) => onPatch(exp.id, { end: e.target.value })}
            className="sm-field-input sm-mono"
          />
        </Field>
        <Field label="location">
          <input
            type="text" value={exp.loc}
            onChange={(e) => onPatch(exp.id, { loc: e.target.value })}
            className="sm-field-input"
          />
        </Field>
      </div>
      <Field label="bullets" hint="one per line · concrete numbers > prose">
        <textarea
          value={exp.bullets.join('\n')} rows={4}
          onChange={(e) => onPatch(exp.id, { bullets: e.target.value.split('\n') })}
          className="w-full sm-field-input sm-reading resize-y"
        />
      </Field>
    </div>
  );
}

export function EducationItem({
  edu, onPatch,
}: { edu: DraftEducation; onPatch: PatchEdu }) {
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 grid grid-cols-2 gap-3">
      <Field label="school">
        <input
          type="text" value={edu.school}
          onChange={(e) => onPatch(edu.id, { school: e.target.value })}
          className="sm-field-input"
        />
      </Field>
      <Field label="degree">
        <input
          type="text" value={edu.degree}
          onChange={(e) => onPatch(edu.id, { degree: e.target.value })}
          className="sm-field-input"
        />
      </Field>
      <Field label="from">
        <input
          type="text" value={edu.start} placeholder="YYYY-MM"
          data-testid={`composer-edu-from-${edu.id}`}
          onChange={(e) => onPatch(edu.id, { start: e.target.value })}
          className="sm-field-input sm-mono"
        />
      </Field>
      <Field label="to" hint="empty → present">
        <input
          type="text" value={edu.end} placeholder="present"
          data-testid={`composer-edu-to-${edu.id}`}
          onChange={(e) => onPatch(edu.id, { end: e.target.value })}
          className="sm-field-input sm-mono"
        />
      </Field>
    </div>
  );
}

export function SocialItem({
  soc, onPatch, onRemove,
}: { soc: DraftSocial; onPatch: PatchSoc; onRemove: () => void }) {
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4">
      <RowHeader testid={`composer-social-remove-${soc.id}`} onRemove={onRemove} />
      <div className="grid grid-cols-[120px_1fr] gap-3">
        <Field label="kind">
          <SelectField
            value={soc.kind}
            onChange={(e) => onPatch(soc.id, { kind: e.target.value })}
            mono
          >
            {SOCIAL_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </SelectField>
        </Field>
        <Field label="handle" hint="url or @handle">
          <input
            type="text" value={soc.handle}
            onChange={(e) => onPatch(soc.id, { handle: e.target.value })}
            className="sm-field-input sm-mono"
            data-testid={`composer-social-handle-${soc.id}`}
          />
        </Field>
      </div>
    </div>
  );
}

// CustomItem —— one owner-named section. `label` is the section title they choose (languages,
// certifications, …) and `value` its content — this is how you add a section the standard
// panels don't cover.
export function CustomItem({
  cus, onPatch, onRemove,
}: { cus: DraftCustom; onPatch: PatchCus; onRemove: () => void }) {
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4">
      <RowHeader testid={`composer-custom-remove-${cus.id}`} onRemove={onRemove} />
      <div className="grid grid-cols-[150px_1fr] gap-3">
        <Field label="section title">
          <input
            type="text" value={cus.label}
            onChange={(e) => onPatch(cus.id, { label: e.target.value })}
            className="sm-field-input"
            placeholder="languages"
            data-testid={`composer-custom-title-${cus.id}`}
          />
        </Field>
        <Field label="content">
          <input
            type="text" value={cus.value}
            onChange={(e) => onPatch(cus.id, { value: e.target.value })}
            className="sm-field-input"
            placeholder="English · Mandarin"
          />
        </Field>
      </div>
    </div>
  );
}
