// resume-puck-config.tsx —— the Puck Config for the résumé editor: the fixed section components the
// owner arranges (Header / Summary / Experience / Education / SkillSet / Social / Custom) plus the
// whole-résumé settings on root. Each component's fields edit one ResumeContent section; its render
// is a readable on-canvas view (the exact PDF look stays in the typst preview pane). See
// docs/design/resume-composer-puck.md (Q0). Field labels are config (not UI copy); render text comes
// from props — so no literal-string / no-if presentation violations.

'use client';

import type { Config } from '@measured/puck';

type TextItem = { text: string };

interface HeaderProps { name: string; email: string; phone: string; locationLine: string; site: string }
interface SummaryProps { text: string }
interface ExperienceProps {
  title: string; company: string; location: string; start: string; end: string; bullets: TextItem[];
}
interface EducationProps { school: string; degree: string; start: string; end: string }
interface SkillSetProps { category: string; items: TextItem[] }
interface SocialProps { kind: string; label: string; handle: string }
interface CustomProps { label: string; value: string; kind: string }

// ResumeComponents —— the props shape per fixed section component (keys are the component names).
interface ResumeComponents {
  Header: HeaderProps;
  Summary: SummaryProps;
  Experience: ExperienceProps;
  Education: EducationProps;
  SkillSet: SkillSetProps;
  Social: SocialProps;
  Custom: CustomProps;
}

interface ResumeRootProps { accent: string; fontScale: number; leftWidth: number; coverLetter: string }

// period —— "start – end" / "start – present" for a display line.
function period(start: string, end: string): string {
  return `${start} – ${end === '' ? 'present' : end}`;
}

// asList —— an array of {text} items (skills / bullets) → "a  ·  b  ·  c" for the canvas preview.
function asList(items: TextItem[]): string {
  return items.map((i) => i.text).join('  ·  ');
}

export const resumePuckConfig: Config<ResumeComponents, ResumeRootProps> = {
  root: {
    fields: {
      accent: { type: 'text', label: 'Accent colour (#RRGGBB)' },
      fontScale: {
        type: 'select',
        label: 'Font size',
        options: [
          { label: 'compact', value: 0.9 },
          { label: 'normal', value: 1 },
          { label: 'large', value: 1.1 },
          { label: 'x-large', value: 1.25 },
        ],
      },
      leftWidth: { type: 'number', label: 'Left column width (fr)' },
      coverLetter: { type: 'textarea', label: 'Cover letter' },
    },
    defaultProps: { accent: '', fontScale: 1, leftWidth: 0.9, coverLetter: '' },
    // The canvas is a DOCUMENT preview: wrap it in the résumé's own fixed paper palette so it renders
    // ink-on-cream (like the PDF) regardless of the editor's day/night — see .sm-resume-paper.
    render: ({ children }) => (
      <div className="sm-resume-paper min-h-full px-10 py-8">{children}</div>
    ),
  },
  components: {
    Header: {
      fields: {
        name: { type: 'text', label: 'Name' },
        email: { type: 'text', label: 'Email' },
        phone: { type: 'text', label: 'Phone' },
        locationLine: { type: 'text', label: 'Location' },
        site: { type: 'text', label: 'Site' },
      },
      defaultProps: { name: '', email: '', phone: '', locationLine: '', site: '' },
      render: ({ name, email, locationLine }) => (
        <div data-sec="header" className="py-2">
          <div className="font-serif text-2xl text-(--color-ink)">{name}</div>
          <div className="mono text-xs text-(--color-muted)">{`${email}  ·  ${locationLine}`}</div>
        </div>
      ),
    },
    Summary: {
      fields: { text: { type: 'textarea', label: 'Summary' } },
      defaultProps: { text: '' },
      render: ({ text }) => (
        <div data-sec="summary" className="py-2 text-(--color-ink) text-[15px] leading-relaxed">{text}</div>
      ),
    },
    Experience: {
      fields: {
        title: { type: 'text', label: 'Role' },
        company: { type: 'text', label: 'Company' },
        location: { type: 'text', label: 'Location' },
        start: { type: 'text', label: 'Start (YYYY-MM)' },
        end: { type: 'text', label: 'End (blank = present)' },
        bullets: { type: 'array', label: 'Bullets', arrayFields: { text: { type: 'text', label: 'Bullet' } } },
      },
      defaultProps: { title: '', company: '', location: '', start: '', end: '', bullets: [] },
      render: ({ title, company, start, end }) => (
        <div data-sec="experience" className="py-2">
          <div className="font-serif text-[17px] text-(--color-ink)">{`${title} · ${company}`}</div>
          <div className="mono text-xs text-(--color-faint)">{period(start, end)}</div>
        </div>
      ),
    },
    Education: {
      fields: {
        school: { type: 'text', label: 'School' },
        degree: { type: 'text', label: 'Degree' },
        start: { type: 'text', label: 'Start' },
        end: { type: 'text', label: 'End' },
      },
      defaultProps: { school: '', degree: '', start: '', end: '' },
      render: ({ school, degree, start, end }) => (
        <div data-sec="education" className="py-2">
          <div className="font-serif text-[15px] text-(--color-ink)">{`${school} — ${degree}`}</div>
          <div className="mono text-xs text-(--color-faint)">{period(start, end)}</div>
        </div>
      ),
    },
    SkillSet: {
      fields: {
        category: { type: 'text', label: 'Category' },
        items: { type: 'array', label: 'Items', arrayFields: { text: { type: 'text', label: 'Skill' } } },
      },
      defaultProps: { category: '', items: [] },
      render: ({ category, items }) => (
        <div data-sec="skillset" className="py-2">
          <span className="mono text-xs uppercase text-(--color-muted)">{category}</span>
          <span className="text-[14px] text-(--color-ink) ml-2">{asList(items)}</span>
        </div>
      ),
    },
    Social: {
      fields: {
        kind: { type: 'text', label: 'Kind (github / linkedin / …)' },
        label: { type: 'text', label: 'Label' },
        handle: { type: 'text', label: 'Handle / URL' },
      },
      defaultProps: { kind: '', label: '', handle: '' },
      render: ({ kind, handle }) => (
        <div data-sec="social" className="py-1 mono text-[13px] text-(--color-ink)">{`${kind}  ${handle}`}</div>
      ),
    },
    Custom: {
      fields: {
        label: { type: 'text', label: 'Heading' },
        value: { type: 'textarea', label: 'Body' },
        kind: {
          type: 'select', label: 'Kind',
          options: [{ label: 'section', value: '' }, { label: 'divider', value: 'divider' }],
        },
      },
      defaultProps: { label: '', value: '', kind: '' },
      render: ({ label, value, kind }) => (
        kind === 'divider'
          ? <hr data-sec="custom" className="my-3 border-(--color-rule)" />
          : (
            <div data-sec="custom" className="py-2">
              <div className="mono text-xs uppercase text-(--color-muted)">{label}</div>
              <div className="text-[14px] text-(--color-ink)">{value}</div>
            </div>
          )
      ),
    },
  },
};
