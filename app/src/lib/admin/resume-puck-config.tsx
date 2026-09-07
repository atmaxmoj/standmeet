// resume-puck-config.tsx —— the Puck Config for the résumé editor: the fixed section components the
// owner arranges (Header / Summary / Experience / Education / SkillSet / Social / Custom) plus the
// whole-résumé settings on root. Each component's fields edit one ResumeContent section; its render
// is a readable on-canvas view (the exact PDF look stays in the typst preview pane). See
// docs/design/resume-composer-puck.md (Q0). Field labels are config (not UI copy); render text comes
// from props — so no literal-string / no-if presentation violations.

'use client';

import type { ReactElement } from 'react';
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

// SecHead —— the résumé's section heading, matching the typst `sechead`: accent-red uppercase mono
// label over a thin rule. This IS the "红色 title" — one source of truth for how a heading looks, in
// the renderer the owner sees AND (once Puck drives the PDF) the renderer that prints.
function SecHead({ title }: { title: string }): ReactElement {
  return (
    <div className="mt-3 mb-1.5">
      <div data-sec-head className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-accent)">{title}</div>
      <hr className="mt-0.5 border-0 border-t border-(--color-rule)" />
    </div>
  );
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
    // The canvas is an A4 sheet (210×297mm): the résumé IS a page, so the editor shows a page, on a
    // subtle desk. aspect-[210/297] keeps A4 proportions at any width (mobile scales the sheet, ratio
    // held); it grows past one page only when content overflows. Own fixed paper palette (ink-on-cream)
    // regardless of the editor's day/night — see .sm-resume-paper.
    render: ({ children }) => (
      <div className="min-h-full flex justify-center bg-black/5 py-8 px-4">
        <div className="sm-resume-paper w-[794px] max-w-full aspect-[210/297] px-[7.5%] py-[6.5%] shadow-[0_2px_24px_rgba(0,0,0,0.12)]">
          {children}
        </div>
      </div>
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
      // The header, matching the typst layout: name (large, lowercase) + contact mono line on the left,
      // the accent-bordered QR card on the right, a rule beneath. (The QR image is per-application, so
      // the editor shows the card frame; the real code's QR fills it once Puck drives the PDF.)
      render: ({ name, email, phone, locationLine, site }) => (
        <div data-sec="header">
          <div className="flex items-end justify-between gap-4 pt-1">
            <div className="min-w-0">
              <div className="font-serif text-[30px] leading-none text-(--color-ink) lowercase">{name}</div>
              <div className="mono text-[11px] text-(--color-muted) mt-2">
                {[email, phone, locationLine, site].filter((s) => s !== '').join('  ·  ')}
              </div>
            </div>
            <div className="shrink-0 border border-(--color-accent) rounded-[2px] p-1">
              <div data-sec="qr" className="w-[46px] h-[46px] bg-white grid place-items-center mono text-[7px] text-(--color-faint)">QR</div>
            </div>
          </div>
          <hr className="mt-2 border-0 border-t-[1.5px] border-(--color-rule)" />
        </div>
      ),
    },
    Summary: {
      fields: { text: { type: 'textarea', label: 'Summary' } },
      defaultProps: { text: '' },
      render: ({ text }) => (
        <div data-sec="summary">
          <SecHead title="summary" />
          <p className="text-(--color-ink) text-[13px] leading-[1.5]">{text}</p>
        </div>
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
      render: ({ title, company, location, start, end, bullets }) => (
        <div data-sec="experience" className="pt-2">
          <div className="flex items-baseline justify-between gap-3">
            <div className="font-serif text-[15px] font-medium text-(--color-ink)">{title}</div>
            <div className="mono text-[9px] text-(--color-faint) shrink-0">{period(start, end)}</div>
          </div>
          <div className="text-[12px] mt-0.5">
            <span className="text-(--color-accent)">{company}</span>
            {location !== '' && <span className="text-(--color-faint)"> · {location}</span>}
          </div>
          <ul className="mt-1 flex flex-col gap-0.5">
            {bullets.map((b, i) => (
              <li key={i} className="flex gap-2 text-[12px] text-(--color-ink)">
                <span className="text-(--color-faint)">•</span><span>{b.text}</span>
              </li>
            ))}
          </ul>
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
        <div data-sec="education" className="pt-1.5">
          <div className="font-serif text-[13px] font-medium text-(--color-ink)">{school}</div>
          {degree !== '' && <div className="text-[11px] text-(--color-muted)">{degree}</div>}
          <div className="mono text-[9px] text-(--color-faint)">{period(start, end)}</div>
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
        <div data-sec="skillset" className="pt-1">
          {category !== '' && <div className="mono text-[9px] uppercase tracking-[0.08em] text-(--color-ink)">{category}</div>}
          <div className="text-[12px] text-(--color-ink)">{asList(items)}</div>
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
        <div data-sec="social" className="mono text-[11px] text-(--color-ink)">
          <span className="text-(--color-muted)">{kind}</span> {handle}
        </div>
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
      // A divider prints the same thin rule the typst template draws (`line`, 0.5pt + rule).
      render: ({ label, value, kind }) => (
        kind === 'divider'
          ? <div data-sec="custom" className="py-1.5"><hr className="border-0 border-t border-(--color-rule)" /></div>
          : (
            <div data-sec="custom">
              <SecHead title={label} />
              <p className="text-[12px] text-(--color-ink)">{value}</p>
            </div>
          )
      ),
    },
  },
};
