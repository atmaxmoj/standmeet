// draft-model —— the shape of the owner draft ResumeComposer edits + its
// derived value (match%).
//
// Design source: docs/design/project/admin.js buildDraftModel + ResumeComposer (8
// panel post-2026-05-28: header / summary / skills / experience /
// education / social / custom / cover).
//
// Key invariants:
//   - the draft is a working copy on the owner client; "save" = the
//     setLastSaved indicator.
//   - send → confirm modal → applications.commit (MCP) writes the
//     application row.
//   - all 8 of the composer's panels' data lives in this one DraftModel;
//     setters go through immutable patches (avoids complicating zustand
//     devtools time travel).
//   - `company` + `role` are job context (which company, what role applying
//     for), not the owner's work history — the header strip's second line renders these two.
//   - `name` + `contact.*` are owner identity, expected to stay stable
//     across drafts (the owner's master profile; synced from settings later).

import { useMemo } from 'react';

import type {
  JobContext,
} from '@/components/admin/resume-page/ResumePage';
import type {
  ResumeContent,
  ResumeCustom,
  ResumeSocial,
} from '@/lib/admin/resume-content';

export interface DraftContact {
  email: string;
  phone: string;
  location: string;
  site: string;
}

export interface DraftExperience {
  id: string;
  org: string;
  role: string;
  range: string;     // YYYY-MM — YYYY-MM | 'present'
  loc: string;
  bullets: readonly string[];
}

export interface DraftEducation {
  id: string;
  school: string;
  degree: string;
  range: string;
}

export interface DraftSocial {
  id: string;
  kind: string;      // linkedin | github | twitter | mastodon | bluesky | website | scholar | medium | substack | other
  handle: string;    // url or @handle
}

export interface DraftCustom {
  id: string;
  label: string;
  value: string;
}

export interface DraftModel {
  id: string;
  /** Recipient company — header strip "for ACME". */
  company: string;
  /** Role applied for — header strip "STAFF ENGINEER · FOR ACME". */
  role: string;
  name: string;
  summary: string;
  contact: DraftContact;
  skills: readonly string[];
  experience: readonly DraftExperience[];
  education: readonly DraftEducation[];
  social: readonly DraftSocial[];
  custom: readonly DraftCustom[];
  coverLetter: string;
}

// **There used to be a `mockDraft()` here** — a design-time placeholder
// resume, sitting under the owner's real name, claiming a Stanford PhD and a
// stint at Google Brain. Once the backend was wired up (#52) the composer
// switched to real data, but the thumbnail on the drafts card was still
// rendering it: two completely different drafts drawing the same fictional
// résumé (F-E-20).
//
// Deleted, not shrunk. Fake data that "looks like a real resume" sitting in
// a job-search product will sooner or later get rendered somewhere else too
// — and the more convincing it looks, the less likely anyone is to spot it
// as fake on sight. A place with missing data now renders empty (F-E-21: an
// empty section doesn't even print its heading), and empty beats fabricated.

// confidenceScore —— the match% gauge on ResumeComposer's top bar: how well
// this resume covers **the job actually applied for**.
//
// rot-A2: it used to count hits from a **fixed** buzzword list
// (retrieval/eval/llm/…) against the resume, starting at 0.5, **without
// looking at what job was applied to at all** — while the tooltip said
// "match against the job description". So switch to a different company, a
// different role, and the score never moved. A gauge claiming to "score
// against the JD" was actually just measuring whether the resume contained a
// handful of buzzwords.
//
// Keywords are now derived from **the job itself** (role + company): how
// many of the job's meaningful words appear in the resume = the match
// signal. Change the job → change the keywords → change the score. It's not
// a real ML eval (there's no full JD text available to the model, only
// role/company), but it now honestly varies with "what was applied to", and
// the tooltip is now accurate. Real ML scoring already happens during job-loop's resume.draft.
export function confidenceScore(model: DraftModel): number {
  const resume = (
    model.summary + ' '
    + model.skills.join(' ') + ' '
    + model.experience.flatMap((e) => [e.role, ...e.bullets]).join(' ') + ' '
    + model.coverLetter
  ).toLowerCase();
  const jobTerms = jobKeywords(model.role, model.company);
  if (jobTerms.length === 0) return 0.4;
  const hits = jobTerms.filter((t) => resume.includes(t)).length;
  return Math.min(0.98, 0.4 + (hits / jobTerms.length) * 0.58);
}

const MATCH_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'staff', 'member', 'technical', 'shift', 'role', 'team',
  'senior', 'junior', 'lead', 'engineer', 'inc', 'llc', 'corp', 'company',
]);

// jobKeywords —— extracts meaningful words from the job applied to (role + company): ≥3 letters, not a stopword, deduplicated.
function jobKeywords(role: string, company: string): string[] {
  const words = `${role} ${company}`.toLowerCase().split(/[^a-z0-9]+/);
  return [...new Set(words.filter((w) => w.length >= 3 && !MATCH_STOPWORDS.has(w)))];
}

export function useMatchPct(model: DraftModel): number {
  return useMemo(() => Math.round(confidenceScore(model) * 100), [model]);
}

// patchModel —— an immutable shallow patch across the whole draft.
export function patchModel(m: DraftModel, p: Partial<DraftModel>): DraftModel {
  return { ...m, ...p };
}

export function patchExperience(
  m: DraftModel, id: string, p: Partial<DraftExperience>,
): DraftModel {
  return {
    ...m,
    experience: m.experience.map((e) => e.id === id ? { ...e, ...p } : e),
  };
}

export function patchEducation(
  m: DraftModel, id: string, p: Partial<DraftEducation>,
): DraftModel {
  return {
    ...m,
    education: m.education.map((e) => e.id === id ? { ...e, ...p } : e),
  };
}

export function patchSocial(
  m: DraftModel, id: string, p: Partial<DraftSocial>,
): DraftModel {
  return {
    ...m,
    social: m.social.map((s) => s.id === id ? { ...s, ...p } : s),
  };
}

export function patchCustom(
  m: DraftModel, id: string, p: Partial<DraftCustom>,
): DraftModel {
  return {
    ...m,
    custom: m.custom.map((c) => c.id === id ? { ...c, ...p } : c),
  };
}

// draftToResumeContent —— adapter from the composer's edit-friendly
// DraftModel to the print-side ResumeContent shape ResumePage consumes.
// Splits the flat skill list into one anonymous category (ResumePage's
// left rail flattens all categories into a bullet list anyway, so a
// single category preserves order without forcing per-skill grouping in
// the UI yet).
export function draftToResumeContent(m: DraftModel): ResumeContent {
  return {
    identity: {
      name: m.name,
      email: m.contact.email,
      phone: m.contact.phone,
      locationLine: m.contact.location,
      site: m.contact.site,
    },
    summary: m.summary,
    coverLetter: m.coverLetter,
    works: m.experience.map((e) => ({
      title: e.role,
      company: e.org,
      location: e.loc,
      period: parseRange(e.range),
      bullets: [...e.bullets].filter((b) => b.trim() !== ''),
    })),
    educations: m.education.map((e) => ({
      school: e.school,
      degree: e.degree,
      period: parseRange(e.range),
    })),
    skills: [{ category: '', items: [...m.skills] }],
    social: m.social
      .filter((s) => s.handle.trim() !== '')
      .map((s): ResumeSocial => ({ kind: s.kind, label: s.kind, handle: s.handle })),
    custom: m.custom
      .filter((c) => c.label.trim() !== '' && c.value.trim() !== '')
      .map((c): ResumeCustom => ({ label: c.label, value: c.value })),
  };
}

export function draftToJobContext(m: DraftModel): JobContext {
  return { role: m.role, company: m.company };
}

// parseRange —— "YYYY-MM — YYYY-MM | present" → { start, end }.
// Tolerates extra spaces and either em-dash or hyphen. Empty / unparseable
// → empty start (ResumePage's formatPeriod renders "—" gracefully).
function parseRange(raw: string): { start: string; end: string | null } {
  const cleaned = raw.replace(/—/g, '-').replace(/\s+/g, ' ').trim();
  const parts = cleaned.split(/\s-\s/).map((s) => s.trim());
  const start = parts[0] ?? '';
  const rawEnd = parts[1] ?? '';
  return { start, end: rawEnd === '' || rawEnd.toLowerCase() === 'present' ? null : rawEnd };
}
