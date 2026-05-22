// resume.ts —— MCP resume.* tool wrappers for spec.
//
// resume.draft / update_draft return multi-content [text(json), embedded(pdf)];
// helpers split them and decode the PDF base64 → Buffer so specs can assert
// "starts with %PDF-" + byte-length lower bound.
//
// resume.discard_draft returns plain `{ok:true}` so we keep the single-content
// callTool path for it.

import type { APIRequestContext } from '@playwright/test';

import { callTool, callToolMulti, type MCPContent } from '@/fixtures/mcp';

export interface FetchedJobSnapshotView {
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

export interface ResumeDraftView {
  draft_id: string;
  job_cache_id: string;
  expires_at: string;
  created_at: string;
  job_snapshot: FetchedJobSnapshotView;
}

export interface ResumeContent {
  identity: {
    name: string; email: string; phone?: string; location_line?: string;
    links?: Array<{ label: string; url: string }>;
  };
  summary: string;
  works: Array<{
    title: string; company: string; location: string;
    period: { start: string; end?: string };
    bullets: string[];
  }>;
  projects: Array<{
    name: string; situation: string; task: string;
    action: string; result: string; supplementary?: string;
  }>;
  educations: Array<{
    school: string; degree: string;
    period: { start: string; end?: string };
  }>;
  skills: Array<{ category: string; items: string[] }>;
}

export interface DraftedResume {
  view: ResumeDraftView;
  pdf: Buffer;
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

// extractDrafted —— turn a [TextContent, EmbeddedResource] tuple into our
// typed view + decoded PDF bytes. Throws if either is missing / wrong type.
function extractDrafted(parts: MCPContent[]): DraftedResume {
  const textPart = parts.find((p) => p.type === 'text');
  const resPart = parts.find((p) => p.type === 'resource');
  if (!textPart || textPart.type !== 'text') {
    throw new Error('resume.draft: missing text content');
  }
  if (!resPart || resPart.type !== 'resource') {
    throw new Error('resume.draft: missing embedded PDF resource');
  }
  const view = JSON.parse(textPart.text) as ResumeDraftView;
  const pdf = Buffer.from(resPart.resource.blob, 'base64');
  return { view, pdf };
}

export interface SubmissionHint {
  type: string;
  target_url: string;
  attachment_uri: string;
  fill_fields: Record<string, string>;
  instructions: string;
}

export interface CommittedApplicationView {
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
      links: [{ label: 'GitHub', url: 'https://github.com/alice' }],
    },
    summary: 'Backend engineer focused on self-hostable platforms.',
    works: [{
      title: 'Staff Engineer', company: 'Acme', location: 'Remote',
      period: { start: '2023-01', end: '2026-04' },
      bullets: ['Shipped X', 'Cut Y latency 40%'],
    }],
    projects: [{
      name: 'StandMeet',
      situation: 'Owner ingestion was manual',
      task: 'Build MCP write tools',
      action: 'Designed jobs/* + resume/* surface',
      result: 'Owner pushes content directly from Claude Desktop',
    }],
    educations: [{
      school: 'UC Berkeley', degree: 'BS EECS',
      period: { start: '2014-09', end: '2018-05' },
    }],
    skills: [{ category: 'Languages', items: ['Go', 'TypeScript'] }],
    ...overrides,
  };
}
