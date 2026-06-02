// draft-model —— ResumeComposer 编辑的 owner draft 形状 + 派生（match%）。
//
// 设计源 docs/design/project/admin.js buildDraftModel + ResumeComposer (8
// panel post-2026-05-28: header / summary / skills / experience /
// education / social / custom / cover).
//
// 关键 invariant：
//   - draft 在 owner client 上是 working copy，"保存" = setLastSaved 提示。
//   - send → confirm modal → applications.commit (MCP) 落 application 行。
//   - composer 8 panel 数据全在这一个 DraftModel 里；setters 走 immutable
//     patch（避免 zustand devtools 时间旅行复杂化）。
//   - `company` + `role` 是 job context（投给哪家、什么角色），不是 owner
//     的工作经历 — header strip 第二行渲染这两个。
//   - `name` + `contact.*` 是 owner identity，跨 draft 应保持稳定（owner
//     master profile 那一份，后续从 settings sync）。

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

// mockDraft —— 没接后端时用的占位 draft，让 ResumeComposer 能跑起来。
// REST endpoint 落地后这层 fixture 改成 fetcher。
export function mockDraft(id: string): DraftModel {
  return {
    id,
    company: 'Anthropic',
    role: 'Member of Technical Staff · retrieval',
    name: 'sijie wang',
    summary: 'Building Lucerna — retrieval substrate for personal corpora. '
      + 'Previously led retrieval-quality at Google Brain. The eval is the '
      + 'product; the model is the tax.',
    contact: {
      email: 'sijie@standmeet.com',
      phone: '',
      location: 'Markham, Ontario',
      site: 'standmeet.com/sijie',
    },
    skills: [
      'retrieval / RAG',
      'evaluation methodology',
      'llm post-training',
      'distributed systems',
      'python / typescript / rust',
    ],
    experience: [
      {
        id: 'e-1', org: 'Lucerna', role: 'founder · technical',
        range: '2024-01 — present', loc: 'Markham',
        bullets: [
          'Founded Lucerna, retrieval substrate for personal corpora.',
          'Built the eval methodology — faithfulness, attribution, refusal-when-absent.',
          'Wrote ~60% of production code; held technical bar across four-person team.',
        ],
      },
      {
        id: 'e-2', org: 'Google Brain', role: 'research engineer',
        range: '2019-01 — 2024-01', loc: 'SF',
        bullets: [
          'Led retrieval quality for 2023 product launch — top-1 38% → 71% in nine months.',
          'Half the gain came from rebuilding the eval rubric. The reframing was the contribution.',
        ],
      },
    ],
    education: [
      { id: 'ed-1', school: 'Stanford', degree: 'PhD, representation learning', range: '2013-09 — 2019-06' },
      { id: 'ed-2', school: 'Tsinghua', degree: 'BSc, applied mathematics', range: '2009-09 — 2013-06' },
    ],
    social: [
      { id: 's-1', kind: 'linkedin', handle: 'linkedin.com/in/your-handle' },
      { id: 's-2', kind: 'github', handle: 'github.com/your-handle' },
    ],
    custom: [
      { id: 'c-1', label: 'languages', value: 'English · Mandarin · learning German' },
    ],
    coverLetter: '',
  };
}

// confidenceScore —— ResumeComposer 顶栏的 match% gauge。看 draft 全文里
// 出现多少 "强信号关键词"，0.5 起步、每命中一次 +3pp、capped 98%。 这不
// 是真 ML eval，只是一个反应式 UI proof — 帮 owner 知道 "edit 后 match
// 是否在涨"。真 ML 评分在 job-loop 的 resume.draft 时已经算了，这里是
// post-edit 的快速反馈。
export function confidenceScore(model: DraftModel, keywords: readonly string[]): number {
  const text = (
    model.summary + ' '
    + model.skills.join(' ') + ' '
    + model.experience.flatMap((e) => [e.role, ...e.bullets]).join(' ') + ' '
    + model.coverLetter
  ).toLowerCase();
  let hits = 0;
  for (const k of keywords) {
    if (text.includes(k.toLowerCase())) hits++;
  }
  return Math.min(0.98, 0.5 + hits * 0.03);
}

export const DEFAULT_KEYWORDS = [
  'retrieval', 'eval', 'evaluation', 'llm', 'rag', 'brain', 'lucerna', 'launch',
];

export function useMatchPct(model: DraftModel): number {
  return useMemo(
    () => Math.round(confidenceScore(model, DEFAULT_KEYWORDS) * 100),
    [model],
  );
}

// patchModel —— immutable 更新整 draft 的浅 patch。
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
