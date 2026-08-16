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

// **这里曾经有一个 `mockDraft()`** —— 设计期的占位简历，挂在 owner 的真名下面声称
// Stanford 博士、Google Brain 任职。后端接上之后（#52）composer 换成了真数据，而
// drafts 卡片上那张缩略图还在画它：两份完全不同的草稿画出同一份虚构履历（F-E-20）。
//
// 删掉，不是改小。一份"看起来像真简历"的假数据待在求职产品里，迟早会有第二处渲染它 ——
// 而它越逼真，越没人会当场认出那是假的。缺数据的地方现在渲染成空（F-E-21：空段落连
// 标题都不印），空比编好。

// confidenceScore —— ResumeComposer 顶栏的 match% gauge：这份简历对**投递的那个职位**的覆盖度。
//
// rot-A2：它曾经拿一张**固定** buzzword 列表（retrieval/eval/llm/…）在简历里数命中、0.5 起步，
// **根本不看投给谁**——tooltip 却写 "match against the job description"。于是换一家公司、换一个角色，
// 分数纹丝不动。一个自称"对着 JD 打分"的表，量的其实是简历里有没有几个热词。
//
// 现在关键词从**投递职位本身**（role + company）派生：职位里的实词有多少在简历里出现 = match 信号。
// 换职位 → 换关键词 → 换分。不是真 ML eval（模型里没有完整 JD 文本，只有 role/company），但它现在
// 诚实地随"投给谁"变化，tooltip 名副其实。真 ML 评分在 job-loop 的 resume.draft 时已算过。
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

// jobKeywords —— 从投递职位（role + company）抽出实词（≥3 字母、非停用词、去重）。
function jobKeywords(role: string, company: string): string[] {
  const words = `${role} ${company}`.toLowerCase().split(/[^a-z0-9]+/);
  return [...new Set(words.filter((w) => w.length >= 3 && !MATCH_STOPWORDS.has(w)))];
}

export function useMatchPct(model: DraftModel): number {
  return useMemo(() => Math.round(confidenceScore(model) * 100), [model]);
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
