// resume-puck.ts —— the projection between the canonical résumé data (ResumeContent, what typst
// renders + MCP resume.draft writes) and Puck's editor data. Puck is the editor; ResumeContent stays
// the single source of truth (十条 #1/#2). Each résumé section is a fixed Puck component; the content
// list's order is the section arrangement. Pure — no I/O, no Puck runtime — so it round-trips under a
// unit test (docs/design/resume-composer-puck.md, Q0 stage 1).

import type {
  ResumeContent, ResumeWork, ResumeEducation, ResumeSkillSet, ResumeSocial, ResumeCustom,
} from '@/lib/admin/resume-content';
import { DEFAULT_LEFT_WIDTH, LEFT_SECTIONS } from '@/lib/admin/draft-model';

// PuckComponent —— one placed component: a fixed section type + its fields. (A structural subset of
// @measured/puck's Data['content'] entry; the real Puck types come in when the editor is wired.)
export interface PuckComponent {
  type: string;
  props: Record<string, unknown>;
}

// PuckData —— the editor document: whole-résumé settings on root, the ordered sections in content.
export interface PuckData {
  root: { props: ResumeRootProps };
  content: PuckComponent[];
  zones: Record<string, never>;
}

interface ResumeRootProps {
  accent: string;
  fontScale: number;
  leftWidth: number;
  leftOrder: string[];
  coverLetter: string;
}

// Component type names — the fixed section templates the owner arranges.
export const SECTION = {
  header: 'Header',
  summary: 'Summary',
  experience: 'Experience',
  education: 'Education',
  skillset: 'SkillSet',
  social: 'Social',
  custom: 'Custom',
} as const;

// toPuckData —— canonical résumé → editor document. Repeatable sections (works/educations/…) become
// one component each, in array order; whole-résumé settings go on root.
export function toPuckData(rc: ResumeContent): PuckData {
  const content: PuckComponent[] = [
    { type: SECTION.header, props: { ...rc.identity } },
    { type: SECTION.summary, props: { text: rc.summary } },
    ...rc.works.map((w) => ({ type: SECTION.experience, props: workProps(w) })),
    ...rc.educations.map((e) => ({ type: SECTION.education, props: eduProps(e) })),
    ...rc.skills.map((s) => ({ type: SECTION.skillset, props: skillProps(s) })),
    ...(rc.social ?? []).map((s) => ({ type: SECTION.social, props: socialProps(s) })),
    ...(rc.custom ?? []).map((c) => ({ type: SECTION.custom, props: customProps(c) })),
  ];
  return {
    root: {
      props: {
        accent: rc.accent ?? '',
        fontScale: rc.fontScale ?? 1,
        leftWidth: rc.leftWidth ?? DEFAULT_LEFT_WIDTH,
        leftOrder: [...(rc.leftOrder ?? LEFT_SECTIONS)],
        coverLetter: rc.coverLetter ?? '',
      },
    },
    content,
    zones: {},
  };
}

// fromPuckData —— editor document → canonical résumé. Groups the placed components back into the
// typed arrays (order preserved); unknown component types are ignored (the canonical stays clean).
export function fromPuckData(pd: PuckData): ResumeContent {
  const of = (t: string): Record<string, unknown>[] =>
    pd.content.filter((c) => c.type === t).map((c) => c.props);
  const header = of(SECTION.header)[0] ?? {};
  const summary = of(SECTION.summary)[0]?.['text'];
  const r = pd.root.props;
  return {
    identity: {
      name: str(header['name']), email: str(header['email']), phone: str(header['phone']),
      locationLine: str(header['locationLine']), site: str(header['site']),
    },
    summary: str(summary),
    coverLetter: r.coverLetter,
    works: of(SECTION.experience).map(readWork),
    educations: of(SECTION.education).map(readEdu),
    skills: of(SECTION.skillset).map(readSkill),
    social: of(SECTION.social).map(readSocial),
    custom: of(SECTION.custom).map(readCustom),
    accent: r.accent,
    fontScale: r.fontScale,
    leftWidth: r.leftWidth,
    leftOrder: [...r.leftOrder],
  };
}

// ── per-section field mapping (canonical → props) ───────────────────────────────────────────────
function workProps(w: ResumeWork): Record<string, unknown> {
  return {
    title: w.title, company: w.company, location: w.location,
    start: w.period.start, end: w.period.end ?? '', bullets: w.bullets.map((t) => ({ text: t })),
  };
}
function eduProps(e: ResumeEducation): Record<string, unknown> {
  return { school: e.school, degree: e.degree, start: e.period.start, end: e.period.end ?? '' };
}
function skillProps(s: ResumeSkillSet): Record<string, unknown> {
  return { category: s.category, items: s.items.map((t) => ({ text: t })) };
}
function socialProps(s: ResumeSocial): Record<string, unknown> {
  return { kind: s.kind, label: s.label ?? '', handle: s.handle };
}
function customProps(c: ResumeCustom): Record<string, unknown> {
  return { label: c.label, value: c.value, kind: c.kind ?? '' };
}

// ── per-section field mapping (props → canonical) ───────────────────────────────────────────────
function readWork(p: Record<string, unknown>): ResumeWork {
  return {
    title: str(p['title']), company: str(p['company']), location: str(p['location']),
    period: { start: str(p['start']), end: emptyToNull(str(p['end'])) },
    bullets: textItems(p['bullets']),
  };
}
function readEdu(p: Record<string, unknown>): ResumeEducation {
  return {
    school: str(p['school']), degree: str(p['degree']),
    period: { start: str(p['start']), end: emptyToNull(str(p['end'])) },
  };
}
function readSkill(p: Record<string, unknown>): ResumeSkillSet {
  return { category: str(p['category']), items: textItems(p['items']) };
}
function readSocial(p: Record<string, unknown>): ResumeSocial {
  return { kind: str(p['kind']), label: str(p['label']), handle: str(p['handle']) };
}
function readCustom(p: Record<string, unknown>): ResumeCustom {
  return { label: str(p['label']), value: str(p['value']), kind: str(p['kind']) };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
// textItems —— read a Puck array field ([{text}, …]) back into a string[]. Tolerates a plain string[]
// too (defensive), so a hand-written or older shape still maps.
function textItems(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === 'string' ? x : itemText(x))).filter((s) => s !== '');
}
function itemText(x: unknown): string {
  return typeof x === 'object' && x !== null && 'text' in x ? str(x.text) : '';
}
function emptyToNull(s: string): string | null {
  return s === '' ? null : s;
}
