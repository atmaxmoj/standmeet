// resume-puck-config.tsx —— the Puck Config for the résumé editor: the fixed section components the
// owner arranges (Header / Summary / Experience / Education / SkillSet / Social / Custom) plus the
// whole-résumé settings on root. Each component's fields edit one ResumeContent section; its render
// is a readable on-canvas view (the exact PDF look stays in the typst preview pane). See
// docs/design/resume-composer-puck.md (Q0). Field labels are config (not UI copy); render text comes
// from props — so no literal-string / no-if presentation violations.

'use client';

import type { CSSProperties, ReactElement } from 'react';
import { useTranslations } from 'next-intl';
import type { Config, Metadata } from '@measured/puck';

import { QRCode } from '@/components/admin/atoms/QRCode';
import { SelectField } from '@/components/atoms/SelectField';
import { useComposerCodeControl } from '@/lib/admin/composer-code-context';
import { cssVars } from '@/lib/ui/css-vars';

// resumeMeta —— the render-time context passed via Puck `metadata` (NOT résumé content, so it's the
// same config for editor + print). qrURL: the real per-application QR to draw (empty in the editor →
// a placeholder card). print: true when rendering for the PDF (a flowing page, not the editor's A4
// sheet-on-a-desk). Read defensively — metadata is an open Record.
// metadata is absent in the editor (<Puck> passes none) and present only when printing (<Render
// metadata={...}>), so read it optionally — an over-eager `puck.metadata['x']` would throw and blank
// the whole editor canvas.
function metaQR(puck: { metadata?: Metadata }): string {
  const v: unknown = puck.metadata?.['qrURL'];
  return typeof v === 'string' ? v : '';
}
function metaPrint(puck: { metadata?: Metadata }): boolean {
  return puck.metadata?.['print'] === true;
}

// paperStyle —— the whole-résumé root knobs, applied as CSS variables on the paper element so every
// descendant follows: the owner's accent colour overrides `--color-accent` (section heads, the
// company name, the QR frame), and `--resume-scale` multiplies every font size (the sizes are written
// `text-[calc(Npx*var(--resume-scale))]`). Empty accent keeps the theme default; scale defaults to 1.
function paperStyle(accent: string, fontScale: number): CSSProperties {
  const base: Record<`--${string}`, string> = { '--resume-scale': String(fontScale) };
  return cssVars(filled(accent) ? { ...base, '--color-accent': accent } : base);
}

type TextItem = { text: string };

// codePicker —— a phantom prop for the Header's access-code picker (a `custom` field, below). It
// never holds real data: the field reads/writes the composer's code selection via context and never
// calls Puck's onChange, so this stays '' and is dropped by fromPuckData (which maps only the named
// identity keys). It exists solely so Puck's typed Config accepts the field on Header.
interface HeaderProps {
  name: string; email: string; phone: string; locationLine: string; site: string; codePicker: string;
}
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

// filled —— a field has real content once trimmed (empty / whitespace-only = not filled). An entry
// with nothing filled renders NOTHING — no heading, no rule, no separators (owner: "没写东西就整个
// entry 带着那些装饰一起不要渲染"), matching the typst template (an empty section prints no heading).
function filled(s: string | undefined): boolean {
  return (s ?? '').trim() !== '';
}

// contactsOf —— the header's contact fields that actually have content, in order (so an empty field
// never leaves a lone " · " separator).
function contactsOf(...xs: (string | undefined)[]): string[] {
  return xs.map((s) => (s ?? '').trim()).filter((s) => s !== '');
}

// bulletsOf —— experience bullets with real text (drops blank rows so no empty "•" prints).
function bulletsOf(items: TextItem[]): string[] {
  return items.map((i) => (i.text ?? '').trim()).filter((s) => s !== '');
}

// SecHead —— the résumé's section heading, matching the typst `sechead`: accent-red uppercase mono
// label over a thin rule. This IS the "红色 title" — one source of truth for how a heading looks, in
// the renderer the owner sees AND (once Puck drives the PDF) the renderer that prints.
function SecHead({ title }: { title: string }): ReactElement {
  return (
    <div className="mt-3 mb-1.5">
      <div data-sec-head className="mono text-[calc(10px*var(--resume-scale))] tracking-[0.14em] uppercase text-(--color-accent)">{title}</div>
      <hr className="mt-0.5 border-0 border-t border-(--color-rule)" />
    </div>
  );
}

// HeaderCodeField —— the access-code picker shown in the Header component's field panel (the QR is a
// Header element, so its code lives with the Header's fields). Wired to the composer's code selection
// via context; it does NOT use Puck's field value/onChange, so nothing persists into resume_content.
// Empty codes → a placeholder option (SEND still auto-issues a fresh code when none is picked).
function HeaderCodeField(): ReactElement {
  const t = useTranslations('adminShell.composer');
  const { activeCodes, codeId, setCodeId } = useComposerCodeControl();
  return (
    <SelectField testid="composer-code-select" aria-label="access code" value={codeId} onChange={(e) => setCodeId(e.target.value)} mono>
      {activeCodes.length === 0
        ? <option value="" data-testid="composer-code-empty">{t('codeNone')}</option>
        : activeCodes.map((c) => <option key={c.id} value={c.id}>{c.label} · {c.code}</option>)}
    </SelectField>
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
    // Editor: an A4 sheet on a desk (aspect-locked, so mobile keeps the ratio). Print (metadata.print):
    // the SAME paper scope but a plain full-width flow so gotenberg's @page can paginate it — no desk,
    // no aspect box, no shadow. One config, both surfaces (the whole point of A3: no second renderer).
    render: ({ children, coverLetter, accent, fontScale, puck }) => metaPrint(puck) ? (
      <div
        className="sm-resume-paper w-full min-h-full px-[7.5%] py-[6.5%]"
        // eslint-disable-next-line no-restricted-syntax -- accent + font-scale are runtime, props-driven résumé knobs applied as CSS vars
        style={paperStyle(accent, fontScale)}
      >
        {children}
        {filled(coverLetter) && (
          <div className="break-before-page pt-8">
            <p className="text-[calc(13px*var(--resume-scale))] leading-[1.6] text-(--color-ink) whitespace-pre-wrap">{coverLetter}</p>
          </div>
        )}
      </div>
    ) : (
      <div className="min-h-full flex justify-center items-start bg-black/5 py-8 px-4">
        <div
          className="sm-resume-paper w-[794px] max-w-full aspect-[210/297] px-[7.5%] py-[6.5%] shadow-[0_2px_24px_rgba(0,0,0,0.12)]"
          // eslint-disable-next-line no-restricted-syntax -- accent + font-scale are runtime, props-driven résumé knobs applied as CSS vars
          style={paperStyle(accent, fontScale)}
        >
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
        // The QR's access code — picked here (with the Header's fields), not in a top bar.
        codePicker: { type: 'custom', label: 'Access code (QR)', render: () => <HeaderCodeField /> },
      },
      defaultProps: { name: '', email: '', phone: '', locationLine: '', site: '', codePicker: '' },
      // name (large, lowercase) + contact line on the left; the QR card on the right — the REAL
      // per-application QR when printing (metadata.qrURL), a placeholder frame in the editor. NO job
      // meta (role·company): that's draft context, not résumé content — printing it was the typst
      // divergence the owner hit ("为什么 pdf 有 draft 的 meta"). Nothing filled → render nothing.
      render: ({ name, email, phone, locationLine, site, puck }) => {
        const contacts = contactsOf(email, phone, locationLine, site);
        const qrURL = metaQR(puck);
        // The QR (the access code) belongs on every résumé, so the header shows whenever there's a QR
        // to draw — even before any name/contact is typed. Name + contacts still suppress individually.
        return (filled(name) || contacts.length > 0 || qrURL !== '') ? (
          <div data-sec="header">
            <div className="flex items-end justify-between gap-4 pt-1">
              <div className="min-w-0">
                {filled(name) && <div className="font-serif text-[calc(30px*var(--resume-scale))] leading-none text-(--color-ink) lowercase">{name}</div>}
                {contacts.length > 0 && <div className="mono text-[calc(11px*var(--resume-scale))] text-(--color-muted) mt-2">{contacts.join('  ·  ')}</div>}
              </div>
              <div data-sec="qr" className="shrink-0 border border-(--color-accent) rounded-[2px] p-1 leading-none">
                {qrURL !== ''
                  ? <QRCode value={qrURL} size={46} />
                  : <div className="w-[46px] h-[46px] bg-white grid place-items-center mono text-[calc(7px*var(--resume-scale))] text-(--color-faint)">QR</div>}
              </div>
            </div>
            <hr className="mt-2 border-0 border-t-[1.5px] border-(--color-rule)" />
          </div>
        ) : <></>;
      },
    },
    Summary: {
      fields: { text: { type: 'textarea', label: 'Summary' } },
      defaultProps: { text: '' },
      // Empty summary → no heading, no rule, nothing.
      render: ({ text }) => filled(text) ? (
        <div data-sec="summary">
          <SecHead title="summary" />
          <p className="text-(--color-ink) text-[calc(13px*var(--resume-scale))] leading-[1.5]">{text}</p>
        </div>
      ) : <></>,
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
      // A blank entry → nothing. Each line only prints when its field has content (no lone " · ", no
      // empty "•", no "– present" for a dateless role).
      render: ({ title, company, location, start, end, bullets }) => {
        const bl = bulletsOf(bullets);
        const dates = filled(start) || filled(end) ? period(start, end) : '';
        const empty = !filled(title) && !filled(company) && !filled(location) && dates === '' && bl.length === 0;
        return empty ? <></> : (
          <div data-sec="experience" className="pt-2">
            <div className="flex items-baseline justify-between gap-3">
              {filled(title) && <div className="font-serif text-[calc(15px*var(--resume-scale))] font-medium text-(--color-ink)">{title}</div>}
              {dates !== '' && <div className="mono text-[calc(9px*var(--resume-scale))] text-(--color-faint) shrink-0">{dates}</div>}
            </div>
            {(filled(company) || filled(location)) && (
              <div className="text-[calc(12px*var(--resume-scale))] mt-0.5">
                {filled(company) && <span className="text-(--color-accent)">{company}</span>}
                {filled(location) && <span className="text-(--color-faint)">{filled(company) ? ` · ${location}` : location}</span>}
              </div>
            )}
            {bl.length > 0 && (
              <ul className="mt-1 flex flex-col gap-0.5">
                {bl.map((b, i) => (
                  <li key={i} className="flex gap-2 text-[calc(12px*var(--resume-scale))] text-(--color-ink)">
                    <span className="text-(--color-faint)">•</span><span>{b}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      },
    },
    Education: {
      fields: {
        school: { type: 'text', label: 'School' },
        degree: { type: 'text', label: 'Degree' },
        start: { type: 'text', label: 'Start' },
        end: { type: 'text', label: 'End' },
      },
      defaultProps: { school: '', degree: '', start: '', end: '' },
      render: ({ school, degree, start, end }) => {
        const dates = filled(start) || filled(end) ? period(start, end) : '';
        return (!filled(school) && !filled(degree) && dates === '') ? <></> : (
          <div data-sec="education" className="pt-1.5">
            {filled(school) && <div className="font-serif text-[calc(13px*var(--resume-scale))] font-medium text-(--color-ink)">{school}</div>}
            {filled(degree) && <div className="text-[calc(11px*var(--resume-scale))] text-(--color-muted)">{degree}</div>}
            {dates !== '' && <div className="mono text-[calc(9px*var(--resume-scale))] text-(--color-faint)">{dates}</div>}
          </div>
        );
      },
    },
    SkillSet: {
      fields: {
        category: { type: 'text', label: 'Category' },
        items: { type: 'array', label: 'Items', arrayFields: { text: { type: 'text', label: 'Skill' } } },
      },
      defaultProps: { category: '', items: [] },
      // No skills → nothing (a bare category with no items is not shown).
      render: ({ category, items }) => {
        const skills = bulletsOf(items);
        return skills.length === 0 ? <></> : (
          <div data-sec="skillset" className="pt-1">
            {filled(category) && <div className="mono text-[calc(9px*var(--resume-scale))] uppercase tracking-[0.08em] text-(--color-ink)">{category}</div>}
            <div className="text-[calc(12px*var(--resume-scale))] text-(--color-ink)">{skills.join('  ·  ')}</div>
          </div>
        );
      },
    },
    Social: {
      fields: {
        kind: { type: 'text', label: 'Kind (github / linkedin / …)' },
        label: { type: 'text', label: 'Label' },
        handle: { type: 'text', label: 'Handle / URL' },
      },
      defaultProps: { kind: '', label: '', handle: '' },
      render: ({ kind, handle }) => filled(handle) ? (
        <div data-sec="social" className="mono text-[calc(11px*var(--resume-scale))] text-(--color-ink)">
          {filled(kind) && <span className="text-(--color-muted)">{kind} </span>}{handle}
        </div>
      ) : <></>,
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
      // A divider is an intentional decoration (prints the thin rule the typst template draws). A
      // section with no heading AND no body → nothing.
      render: ({ label, value, kind }) => {
        const divider = kind === 'divider';
        return divider
          ? <div data-sec="custom" className="py-1.5"><hr className="border-0 border-t border-(--color-rule)" /></div>
          : (!filled(label) && !filled(value)) ? <></> : (
            <div data-sec="custom">
              {filled(label) && <SecHead title={label} />}
              {filled(value) && <p className="text-[calc(12px*var(--resume-scale))] text-(--color-ink)">{value}</p>}
            </div>
          );
      },
    },
  },
};
