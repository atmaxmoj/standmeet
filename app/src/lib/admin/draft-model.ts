// draft-model —— ResumeComposer 编辑的 owner draft 形状 + 派生（match%）。
//
// 设计源 docs/design/project/admin.js buildDraftModel + ResumeComposer。
// 现在 (post-P3) 还没真接通后端 resume_draft REST 列表；这层先用 mock
// fixture + client-side state，UI 跑通；后续 job-loop 加 admin endpoint
// 时改用 fetch + PUT。
//
// 关键 invariant：
//   - draft 在 owner client 上是 working copy，"保存" = setLastSaved 提示。
//   - send → confirm modal → applications.commit (MCP) 落 application 行。
//   - composer 6 panel 数据全在这一个 DraftModel 里；setters 走 immutable
//     patch（避免 zustand devtools 时间旅行复杂化）。

export interface DraftContact {
  email: string;
  location: string;
  site: string;
}

export interface DraftExperience {
  id: string;
  org: string;
  role: string;
  range: string;
  loc: string;
  bullets: readonly string[];
}

export interface DraftEducation {
  id: string;
  school: string;
  degree: string;
  range: string;
}

export interface DraftModel {
  id: string;
  company: string;
  role: string;
  summary: string;
  contact: DraftContact;
  skills: readonly string[];
  experience: readonly DraftExperience[];
  education: readonly DraftEducation[];
  coverLetter: string;
}

// mockDraft —— 没接后端时用的占位 draft，让 ResumeComposer 能跑起来。
// REST endpoint 落地后这层 fixture 改成 fetcher。
export function mockDraft(id: string): DraftModel {
  return {
    id,
    company: 'Anthropic',
    role: 'Member of Technical Staff · retrieval',
    summary: 'Building Lucerna — retrieval substrate for personal corpora. '
      + 'Previously led retrieval-quality at Google Brain. The eval is the '
      + 'product; the model is the tax.',
    contact: {
      email: 'sijie@standmeet.com',
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
        id: 'e-1',
        org: 'Lucerna',
        role: 'founder · technical',
        range: '2024 — present',
        loc: 'Markham',
        bullets: [
          'Founded Lucerna, retrieval substrate for personal corpora.',
          'Built the eval methodology — faithfulness, attribution, refusal-when-absent.',
          'Wrote ~60% of production code; held technical bar across four-person team.',
        ],
      },
      {
        id: 'e-2',
        org: 'Google Brain',
        role: 'research engineer',
        range: '2019 — 2024',
        loc: 'SF',
        bullets: [
          'Led retrieval quality for 2023 product launch — top-1 38% → 71% in nine months.',
          'Half the gain came from rebuilding the eval rubric. The reframing was the contribution.',
        ],
      },
    ],
    education: [
      { id: 'ed-1', school: 'Stanford', degree: 'PhD, representation learning', range: '2013 — 2019' },
      { id: 'ed-2', school: 'Tsinghua', degree: 'BSc, applied mathematics', range: '2009 — 2013' },
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

// useMatchPct —— ResumeComposer top-bar match gauge 的 derived state。
// presentation 层不准跑 useMemo，所以抽出来。返 0-100 整数。
import { useMemo } from 'react';

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

// patchExperience —— 改一条 experience entry。caller 给 id + Partial。
export function patchExperience(
  m: DraftModel, id: string, p: Partial<DraftExperience>,
): DraftModel {
  return {
    ...m,
    experience: m.experience.map((e) => e.id === id ? { ...e, ...p } : e),
  };
}

// patchEducation —— 改一条 education entry。
export function patchEducation(
  m: DraftModel, id: string, p: Partial<DraftEducation>,
): DraftModel {
  return {
    ...m,
    education: m.education.map((e) => e.id === id ? { ...e, ...p } : e),
  };
}
