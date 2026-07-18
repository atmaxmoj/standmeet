// ComposerPanels —— ResumeComposer 左侧 8 个 panel 的编辑器集合。
// 每个 panel 是 plain form：header / summary / skills / experience /
// education / social / custom / cover。改动通过 onPatch* 回传到
// ResumeComposer 持的 draft model。
//
// 设计源 docs/design/project/admin.js ResumeComposer。
// experience / education 的 add/remove 这一版先用 push-only（不删，
// 改 bullets 用 split-by-newline）；先把 UX 跑通，后续再加 inline ✕ 按钮。

'use client';

import type {
  DraftCustom,
  DraftEducation,
  DraftExperience,
  DraftModel,
  DraftSocial,
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
          onChange={(e) => onPatch({ contact: { ...model.contact, email: e.target.value } })}
          className="sm-field-input sm-mono"
        />
      </Field>
      <Field label="phone" hint="optional">
        <input
          type="tel" value={model.contact.phone}
          onChange={(e) => onPatch({ contact: { ...model.contact, phone: e.target.value } })}
          className="sm-field-input sm-mono"
        />
      </Field>
      <Field label="location">
        <input
          type="text" value={model.contact.location}
          onChange={(e) => onPatch({ contact: { ...model.contact, location: e.target.value } })}
          className="sm-field-input"
        />
      </Field>
      <Field label="site">
        <input
          type="text" value={model.contact.site}
          onChange={(e) => onPatch({ contact: { ...model.contact, site: e.target.value } })}
          className="sm-field-input sm-mono"
        />
      </Field>
    </Section>
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

function ExperiencePanel({ model, onPatchExp }: Props) {
  return (
    <Section title="experience" hint="most recent first · bullets one per line">
      {model.experience.map((e) => (
        <ExperienceItem key={e.id} exp={e} onPatch={onPatchExp} />
      ))}
    </Section>
  );
}

function ExperienceItem({
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
        <Field label="range">
          <input
            type="text" value={exp.range}
            onChange={(e) => onPatch(exp.id, { range: e.target.value })}
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

function EducationPanel({ model, onPatchEdu }: Props) {
  return (
    <Section title="education" hint="institution · degree · range">
      {model.education.map((e) => (
        <EducationItem key={e.id} edu={e} onPatch={onPatchEdu} />
      ))}
    </Section>
  );
}

function EducationItem({
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
      <Field label="range">
        <input
          type="text" value={edu.range}
          onChange={(e) => onPatch(edu.id, { range: e.target.value })}
          className="sm-field-input sm-mono col-span-2"
        />
      </Field>
    </div>
  );
}

function SocialPanel({ model, onPatchSoc }: Props) {
  return (
    <Section title="social" hint="public profiles the recruiter can verify; top one shows first">
      {model.social.map((s) => (
        <SocialItem key={s.id} soc={s} onPatch={onPatchSoc} />
      ))}
    </Section>
  );
}

const SOCIAL_KINDS = [
  'linkedin', 'github', 'twitter', 'mastodon', 'bluesky',
  'website', 'scholar', 'medium', 'substack', 'other',
];

function SocialItem({
  soc, onPatch,
}: { soc: DraftSocial; onPatch: PatchSoc }) {
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 grid grid-cols-[120px_1fr] gap-3">
      <Field label="kind">
        <select
          value={soc.kind}
          onChange={(e) => onPatch(soc.id, { kind: e.target.value })}
          className="sm-field-input sm-mono"
        >
          {SOCIAL_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </Field>
      <Field label="handle" hint="url or @handle">
        <input
          type="text" value={soc.handle}
          onChange={(e) => onPatch(soc.id, { handle: e.target.value })}
          className="sm-field-input sm-mono"
        />
      </Field>
    </div>
  );
}

function CustomPanel({ model, onPatchCus }: Props) {
  return (
    <Section title="custom" hint="anything outside the standard fields — languages, certs, hobbies">
      {model.custom.map((c) => (
        <CustomItem key={c.id} cus={c} onPatch={onPatchCus} />
      ))}
    </Section>
  );
}

function CustomItem({
  cus, onPatch,
}: { cus: DraftCustom; onPatch: PatchCus }) {
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 grid grid-cols-[150px_1fr] gap-3">
      <Field label="label">
        <input
          type="text" value={cus.label}
          onChange={(e) => onPatch(cus.id, { label: e.target.value })}
          className="sm-field-input"
          placeholder="languages"
        />
      </Field>
      <Field label="value">
        <input
          type="text" value={cus.value}
          onChange={(e) => onPatch(cus.id, { value: e.target.value })}
          className="sm-field-input"
          placeholder="English · Mandarin"
        />
      </Field>
    </div>
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

function Section({
  title, hint, children,
}: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <header>
        <div className="sm-smallcaps">{title}</div>
        <p className="sm-reading text-(--color-muted) text-[13.5px] mt-1">{hint}</p>
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="sm-field">
      <span className="sm-field-label">
        {label}
        {hint && <span className="sm-field-hint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
