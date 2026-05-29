// resume.ts —— MCP resume.* tool wrappers for spec.
//
// resume.draft / update_draft now return a single TextContent (JSON view).
// The PDF render moved out of these tools — the admin browser renders the
// React `ResumePage` live preview, and applications.commit renders the
// final via the gotenberg sidecar. Specs that wanted PDF bytes from a
// draft preview should drive the admin UI instead.
//
// resume.discard_draft returns plain `{ok:true}` so we keep the single-content
// callTool path for it.

import type { APIRequestContext } from '@playwright/test';

import { callTool, callToolMulti, type MCPContent } from '@/fixtures/mcp';

interface FetchedJobSnapshotView {
  cache_id: string;
  source_id: string;
  source_kind: string;
  external_id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  body_text?: string;
  tags: string[];
  published_at?: string;
}

interface ResumeDraftView {
  draft_id: string;
  job_cache_id: string;
  expires_at: string;
  created_at: string;
  job_snapshot: FetchedJobSnapshotView;
}

export interface ResumeContent {
  identity: {
    name: string; email: string; phone?: string; location_line?: string;
    site?: string;
    links?: Array<{ label: string; url: string }>;
  };
  summary: string;
  cover_letter?: string;
  works: Array<{
    title: string; company: string; location: string;
    period: { start: string; end?: string };
    bullets: string[];
  }>;
  educations: Array<{
    school: string; degree: string;
    period: { start: string; end?: string };
  }>;
  skills: Array<{ category: string; items: string[] }>;
  social?: Array<{ kind: string; label?: string; handle: string }>;
  custom?: Array<{ label: string; value: string }>;
}

export interface DraftedResume {
  view: ResumeDraftView;
}

export async function resumeDraft(
  request: APIRequestContext, bearer: string, sid: string,
  jobCacheID: string, content: ResumeContent,
): Promise<DraftedResume> {
  const parts = await callToolMulti(request, bearer, sid, 'resume.draft', {
    job_cache_id: jobCacheID, resume_content: content,
  });
  return extractDrafted(parts);
}

export async function resumeUpdateDraft(
  request: APIRequestContext, bearer: string, sid: string,
  draftID: string, content: ResumeContent,
): Promise<DraftedResume> {
  const parts = await callToolMulti(request, bearer, sid, 'resume.update_draft', {
    draft_id: draftID, resume_content: content,
  });
  return extractDrafted(parts);
}

export async function resumeDiscardDraft(
  request: APIRequestContext, bearer: string, sid: string, draftID: string,
): Promise<{ ok: boolean }> {
  return callTool<{ ok: boolean }>(request, bearer, sid, 'resume.discard_draft', {
    draft_id: draftID,
  });
}

// extractDrafted —— pull the single TextContent JSON view out of the
// MCP response.
function extractDrafted(parts: MCPContent[]): DraftedResume {
  const textPart = parts.find((p) => p.type === 'text');
  if (!textPart || textPart.type !== 'text') {
    throw new Error('resume.draft: missing text content');
  }
  const view = JSON.parse(textPart.text) as ResumeDraftView;
  return { view };
}

interface SubmissionHint {
  type: string;
  target_url: string;
  attachment_uri: string;
  fill_fields: Record<string, string>;
  instructions: string;
}

interface CommittedApplicationView {
  application_id: string;
  access_code_id: string;
  access_code: string;
  qr_url: string;
  status: string;
  created_at: string;
  code_expires_at?: string;
  job_snapshot: FetchedJobSnapshotView;
  next_action: SubmissionHint;
}

export interface CommittedApplication {
  view: CommittedApplicationView;
  pdf: Buffer;
}

export async function applicationsCommit(
  request: APIRequestContext, bearer: string, sid: string, draftID: string,
): Promise<CommittedApplication> {
  const parts = await callToolMulti(request, bearer, sid, 'applications.commit', {
    draft_id: draftID,
  });
  const textPart = parts.find((p) => p.type === 'text');
  const resPart = parts.find((p) => p.type === 'resource');
  if (!textPart || textPart.type !== 'text') {
    throw new Error('applications.commit: missing text content');
  }
  if (!resPart || resPart.type !== 'resource') {
    throw new Error('applications.commit: missing embedded PDF resource');
  }
  const view = JSON.parse(textPart.text) as CommittedApplicationView;
  const pdf = Buffer.from(resPart.resource.blob, 'base64');
  return { view, pdf };
}

// sampleResumeContent —— minimal-but-realistic content for spec assertions.
// Spec can deep-clone + tweak fields rather than spelling out a giant literal
// each time.
export function sampleResumeContent(overrides?: Partial<ResumeContent>): ResumeContent {
  return {
    identity: {
      name: 'Alice Anderson',
      email: 'alice@example.com',
      phone: '+1 415 555 0100',
      location_line: 'San Francisco, CA',
      site: 'standmeet.com/alice',
    },
    summary: 'Backend engineer focused on self-hostable platforms. I think the eval is the product; the model is the tax. Tailored for this loop on the rebuilt-eval story — top-1 retrieval 38% → 71% over nine months at a 2023 launch.',
    cover_letter: `Dear team,

The role caught my eye for the obvious reason — what I think about retrieval is downstream of the eval, and the way you're framing this role tells me you're making the same wager.

I led retrieval-quality for a 2023 product launch at Acme; we moved top-1 from 38% to 71% over nine months. The story I want to tell on a call isn't the number — it's the reframe: half of the gain was modeling, half was rebuilding the eval to measure something that mattered. I expect that frame is portable to your stack.

Happy to share more on a 30-min call. The QR on page 1 also drops you straight into a chat with my AI · grounded in my corpus · scoped for this conversation.

— Alice`,
    works: [
      {
        title: 'staff engineer', company: 'Acme', location: 'Remote',
        period: { start: '2023-01', end: '' },
        bullets: [
          'Led retrieval-quality for the 2023 product launch — top-1 38% → 71% in nine months. Half of the gain was modeling, half was rebuilding the eval rubric to measure something that mattered.',
          'Authored the team’s ML-onboarding doc, copied into three adjacent teams.',
          'Hold technical bar on a four-person backend; wrote ~60% of the production code.',
        ],
      },
      {
        title: 'software engineer', company: 'Stripe', location: 'SF',
        period: { start: '2018-06', end: '2022-12' },
        bullets: [
          'Payments reliability — wrote idempotency-layer caching that handled ~12% of total traffic.',
          'Pre-Acme career step; mostly distributed systems and on-call discipline.',
        ],
      },
    ],
    educations: [
      { school: 'UC Berkeley', degree: 'BS, EECS', period: { start: '2014-09', end: '2018-05' } },
    ],
    skills: [
      { category: 'core', items: ['retrieval / RAG', 'evaluation methodology', 'distributed systems'] },
      { category: 'lang', items: ['Go', 'TypeScript', 'Python'] },
    ],
    social: [
      { kind: 'linkedin', handle: 'linkedin.com/in/alice' },
      { kind: 'github', handle: 'github.com/alice' },
      { kind: 'twitter', handle: '@alice' },
    ],
    custom: [
      { label: 'languages', value: 'English · Mandarin · learning German' },
      { label: 'side', value: 'modal logic; running 50km/wk' },
    ],
    ...overrides,
  };
}
