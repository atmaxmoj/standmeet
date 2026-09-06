// ComposerPanels —— the editor collection for ResumeComposer's 8 left-side panels.
// Each panel is a plain form: header / summary / skills / experience /
// education / social / custom / cover. Edits flow back through onPatch* to
// the draft model held by ResumeComposer.
//
// Design source: docs/design/project/admin.js ResumeComposer.
//
// Every repeatable section (experience / education / social / custom) has an add button + an
// EmptyHint; social / custom also have a per-row remove (RowHeader). Before, social / custom had
// no add at all, so an empty draft's panel showed nothing to type into (F-E-22).

'use client';

import {
  AddBtn, EmptyHint, Field, Section,
  blankCustom, blankDivider, blankEducation, blankExperience, blankSocial,
} from '@/components/admin/composer/ComposerAtoms';
import {
  CustomItem, EducationItem, ExperienceItem, SocialItem,
} from '@/components/admin/composer/ComposerItems';
import { ReorderableRows } from '@/components/admin/composer/ReorderableRows';
import { SelectField } from '@/components/atoms/SelectField';
import {
  reorder,
  type DraftCustom,
  type DraftEducation,
  type DraftExperience,
  type DraftModel,
  type DraftSocial,
} from '@/lib/admin/draft-model';

type Patch = (p: Partial<DraftModel>) => void;
type PatchExp = (id: string, p: Partial<DraftExperience>) => void;
type PatchEdu = (id: string, p: Partial<DraftEducation>) => void;
type PatchSoc = (id: string, p: Partial<DraftSocial>) => void;
type PatchCus = (id: string, p: Partial<DraftCustom>) => void;

interface Props {
  panel: string;
  model: DraftModel;
  onPatch: Patch;
  onPatchExp: PatchExp;
  onPatchEdu: PatchEdu;
  onPatchSoc: PatchSoc;
  onPatchCus: PatchCus;
}

const PANEL_MAP: Record<string, (p: Props) => React.ReactElement> = {
  header: HeaderPanel,
  summary: SummaryPanel,
  skills: SkillsPanel,
  experience: ExperiencePanel,
  education: EducationPanel,
  social: SocialPanel,
  custom: CustomPanel,
  cover: CoverPanel,
};

export function ComposerPanel(props: Props) {
  const C = PANEL_MAP[props.panel] ?? HeaderPanel;
  return <C {...props} />;
}

function HeaderPanel({ model, onPatch }: Props) {
  return (
    <Section title="header" hint="who you are + what you're applying for; tops the PDF">
      <Field label="your name">
        <input
          type="text" value={model.name}
          onChange={(e) => onPatch({ name: e.target.value })}
          className="sm-field-input"
          data-testid="composer-name"
        />
      </Field>
      <Field label="company" hint="receives the resume">
        <input
          type="text" value={model.company}
          onChange={(e) => onPatch({ company: e.target.value })}
          className="sm-field-input"
          data-testid="composer-company"
        />
      </Field>
      <Field label="role" hint="title applied for">
        <input
          type="text" value={model.role}
          onChange={(e) => onPatch({ role: e.target.value })}
          className="sm-field-input"
          data-testid="composer-role"
        />
      </Field>
      <Field label="email">
        <input
          type="email" value={model.contact.email}
          data-testid="composer-email"
          onChange={(e) => onPatch({ contact: { ...model.contact, email: e.target.value } })}
          className="sm-field-input sm-mono"
        />
      </Field>
      <Field label="phone" hint="optional">
        <input
          type="tel" value={model.contact.phone}
          data-testid="composer-phone"
          onChange={(e) => onPatch({ contact: { ...model.contact, phone: e.target.value } })}
          className="sm-field-input sm-mono"
        />
      </Field>
      <Field label="location">
        <input
          type="text" value={model.contact.location}
          data-testid="composer-location"
          onChange={(e) => onPatch({ contact: { ...model.contact, location: e.target.value } })}
          className="sm-field-input"
        />
      </Field>
      <Field label="site">
        <input
          type="text" value={model.contact.site}
          data-testid="composer-site"
          onChange={(e) => onPatch({ contact: { ...model.contact, site: e.target.value } })}
          className="sm-field-input sm-mono"
        />
      </Field>
      <AccentField model={model} onPatch={onPatch} />
      <FontSizeField model={model} onPatch={onPatch} />
    </Section>
  );
}

// AccentField —— the owner's accent colour (section heads / company / rules). Extracted so HeaderPanel
// stays under the per-function line cap. Empty accent shows the template default in the picker.
function AccentField({ model, onPatch }: {
  model: DraftModel; onPatch: (p: Partial<DraftModel>) => void;
}) {
  return (
    <Field label="accent color" hint="section heads · company · rules">
      <input
        type="color"
        value={model.accent === '' ? '#9B3018' : model.accent}
        data-testid="composer-accent"
        onChange={(e) => onPatch({ accent: e.target.value })}
        className="h-8 w-16 cursor-pointer bg-transparent"
      />
    </Field>
  );
}

// FONT_SCALES —— the selectable whole-résumé font-size multipliers. A number (not S/M/L) so the
// template just multiplies every size by it; 1 = the template's default.
const FONT_SCALES: readonly { label: string; scale: number }[] = [
  { label: 'compact', scale: 0.9 },
  { label: 'normal', scale: 1 },
  { label: 'large', scale: 1.1 },
  { label: 'x-large', scale: 1.25 },
];

// FontSizeField —— the owner's font-size choice, scaling the whole résumé (read by the template as
// data.font_scale). A select, not a slider: a small fixed set keeps the layout predictable.
function FontSizeField({ model, onPatch }: {
  model: DraftModel; onPatch: (p: Partial<DraftModel>) => void;
}) {
  return (
    <Field label="font size" hint="scales the whole résumé">
      <SelectField
        value={String(model.fontScale)}
        testid="composer-font-size"
        onChange={(e) => onPatch({ fontScale: Number(e.target.value) })}
      >
        {FONT_SCALES.map((f) => (
          <option key={f.scale} value={String(f.scale)}>{f.label}</option>
        ))}
      </SelectField>
    </Field>
  );
}

function SummaryPanel({ model, onPatch }: Props) {
  return (
    <Section title="summary" hint="2-3 sentence framing; same voice you'd use on the call">
      <textarea
        value={model.summary} rows={6}
        onChange={(e) => onPatch({ summary: e.target.value })}
        data-testid="composer-summary"
        className="w-full sm-field-input sm-reading resize-y"
      />
    </Section>
  );
}

function SkillsPanel({ model, onPatch }: Props) {
  return (
    <Section title="skills" hint="comma-separated; ordered by relevance">
      <textarea
        value={model.skills.join(', ')} rows={4}
        onChange={(e) => onPatch({ skills: parseSkills(e.target.value) })}
        data-testid="composer-skills"
        className="w-full sm-field-input sm-mono resize-y"
      />
    </Section>
  );
}

function parseSkills(raw: string): string[] {
  return raw.split(/,\s*/).map((s) => s.trim()).filter((s) => s !== '');
}

function ExperiencePanel({ model, onPatch, onPatchExp }: Props) {
  return (
    <Section title="experience" hint="most recent first · drag ⠿ to reorder · bullets one per line">
      <ReorderableRows
        items={model.experience}
        testidPrefix="composer-exp"
        onReorder={(f, t) => onPatch({ experience: reorder(model.experience, f, t) })}
        renderItem={(e) => <ExperienceItem exp={e} onPatch={onPatchExp} />}
      />
      <EmptyHint
        show={model.experience.length === 0}
        what="roles"
        testid="composer-exp-empty"
      />
      <AddBtn
        label="+ add a role"
        testid="composer-exp-add"
        onClick={() => onPatch({
          experience: [...model.experience, blankExperience(model.experience.length)],
        })}
      />
    </Section>
  );
}

function EducationPanel({ model, onPatch, onPatchEdu }: Props) {
  return (
    <Section title="education" hint="institution · degree · range · drag ⠿ to reorder">
      <ReorderableRows
        items={model.education}
        testidPrefix="composer-edu"
        onReorder={(f, t) => onPatch({ education: reorder(model.education, f, t) })}
        renderItem={(e) => <EducationItem edu={e} onPatch={onPatchEdu} />}
      />
      <EmptyHint
        show={model.education.length === 0}
        what="schools"
        testid="composer-edu-empty"
      />
      <AddBtn
        label="+ add a school"
        testid="composer-edu-add"
        onClick={() => onPatch({
          education: [...model.education, blankEducation(model.education.length)],
        })}
      />
    </Section>
  );
}

function SocialPanel({ model, onPatch, onPatchSoc }: Props) {
  return (
    <Section title="social" hint="public profiles the recruiter can verify; drag ⠿ — top one shows first">
      <ReorderableRows
        items={model.social}
        testidPrefix="composer-social"
        onReorder={(f, t) => onPatch({ social: reorder(model.social, f, t) })}
        renderItem={(s) => (
          <SocialItem
            soc={s} onPatch={onPatchSoc}
            onRemove={() => onPatch({ social: model.social.filter((x) => x.id !== s.id) })}
          />
        )}
      />
      <EmptyHint show={model.social.length === 0} what="profiles" testid="composer-social-empty" />
      <AddBtn
        label="+ add a profile"
        testid="composer-social-add"
        onClick={() => onPatch({ social: [...model.social, blankSocial(model.social.length)] })}
      />
    </Section>
  );
}

// CustomPanel —— the owner's own named sections. Each row's `label` is a section title they choose
// (languages, certifications, speaking, …) and `value` its content — this is how you add a section
// the standard panels don't cover.
function CustomPanel({ model, onPatch, onPatchCus }: Props) {
  return (
    <Section title="custom" hint="your own named sections — the label is the section title · drag ⠿ to reorder">
      <ReorderableRows
        items={model.custom}
        testidPrefix="composer-custom"
        onReorder={(f, t) => onPatch({ custom: reorder(model.custom, f, t) })}
        renderItem={(c) => (
          <CustomItem
            cus={c} onPatch={onPatchCus}
            onRemove={() => onPatch({ custom: model.custom.filter((x) => x.id !== c.id) })}
          />
        )}
      />
      <EmptyHint show={model.custom.length === 0} what="sections" testid="composer-custom-empty" />
      <AddBtn
        label="+ add a section"
        testid="composer-custom-add"
        onClick={() => onPatch({ custom: [...model.custom, blankCustom(model.custom.length)] })}
      />
      <AddBtn
        label="+ add a divider"
        testid="composer-divider-add"
        onClick={() => onPatch({ custom: [...model.custom, blankDivider(model.custom.length)] })}
      />
    </Section>
  );
}

function CoverPanel({ model, onPatch }: Props) {
  return (
    <Section title="cover letter" hint="optional · address by company name; lead with the wager">
      <textarea
        value={model.coverLetter} rows={14}
        onChange={(e) => onPatch({ coverLetter: e.target.value })}
        data-testid="composer-cover"
        placeholder="Dear team, ..."
        className="w-full sm-field-input sm-reading resize-y"
      />
    </Section>
  );
}

