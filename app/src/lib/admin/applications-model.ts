// applications-model —— admin /applications 的 Application 数据形态 +
// timeline 派生 + 状态枚举。
//
// 设计源 docs/design/project/admin.js APPLICATIONS + ApplicationDetailModal
// (1825-1908)。
//
// 现状：data 还是 mock fixture，等后端补 `GET /api/admin/applications`
// 再切真 fetch（job loop memory: applications 已在表里）。
// commit + send 走 MCP `applications.commit`，所以这层只读 + status PATCH。

export type ApplicationStatus =
  | 'silent' | 'reviewing' | 'replied' | 'rejected' | 'offer';

export const APPLICATION_STATUSES: readonly ApplicationStatus[] = [
  'silent', 'reviewing', 'replied', 'rejected', 'offer',
];

export interface Application {
  id: string;
  company: string;
  role: string;
  sentAt: string;
  method: string;
  contact: string;
  notes: string;
  status: ApplicationStatus;
  // resume snapshot 简化版：标题行 + 一段 delta（tailored 给该 job 的 punch）
  resumeDelta: string;
}

export interface TimelineEvent {
  t: string;
  label: string;
  kind: 'accent' | 'muted' | 'faint';
}

// MOCK_APPLICATIONS —— 直到 admin REST 通了为止用这个填 ApplicationsSection。
export const MOCK_APPLICATIONS: readonly Application[] = [
  {
    id: 'a-anth-mts',
    company: 'Anthropic',
    role: 'Member of Technical Staff · retrieval',
    sentAt: '4 days ago',
    method: 'autofill · Playwright',
    contact: 'careers@anthropic.com',
    notes: 'Saw retrieval-quality opening on the careers page; tailored summary lands on the eval-is-the-product framing.',
    status: 'reviewing',
    resumeDelta: 'Reframed Brain story around the eval rebuild — half of the launch gain came from rubric, not the model.',
  },
  {
    id: 'a-openai-re',
    company: 'OpenAI',
    role: 'Research Engineer · long-context',
    sentAt: '2 weeks ago',
    method: 'manual',
    contact: 'noreply@openai.com',
    notes: '',
    status: 'silent',
    resumeDelta: 'Long-context retrieval angle; emphasized distributed systems prior.',
  },
];

// timelineFor —— 按 status 派生 4-step timeline。设计的 mock 4 行 + kind。
// 不是真 timeline 数据；是 owner 浏览 UI 用的可视化。后续接 mailbox-tracker
// (webhook 进 backend) 后这层换成真 events。
export function timelineFor(app: Application): TimelineEvent[] {
  return [
    { t: app.sentAt, label: 'application sent', kind: 'accent' },
    {
      t: '6 hours later',
      label: 'application opened (mailbox tracker)',
      kind: 'muted',
    },
    {
      t: 'next morning',
      label: 'recruiter replied · scheduling',
      kind: app.status === 'reviewing' || app.status === 'replied'
        || app.status === 'offer' ? 'accent' : 'faint',
    },
    {
      t: 'in progress',
      label: labelForStatus(app.status),
      kind: kindForStatus(app.status),
    },
  ];
}

function labelForStatus(status: ApplicationStatus): string {
  switch (status) {
    case 'reviewing': return 'reviewing';
    case 'replied':   return 'replied';
    case 'offer':     return 'offer extended';
    case 'rejected':  return 'rejected';
    default:          return 'silent';
  }
}

function kindForStatus(status: ApplicationStatus): 'accent' | 'muted' | 'faint' {
  return status === 'offer' || status === 'reviewing' || status === 'replied'
    ? 'accent'
    : status === 'rejected' ? 'muted' : 'faint';
}

// pillToneFor —— ApplicationsSection 列表行的 status pill tone class。
// 抽到 lib/ 因为 presentation 层不准跑 if/复杂三元。
export function pillToneFor(status: ApplicationStatus): string {
  return STATUS_PILL_TONE[status];
}

const STATUS_PILL_TONE: Record<ApplicationStatus, string> = {
  offer: 'is-accent',
  reviewing: 'is-accent',
  replied: 'is-accent',
  rejected: 'is-violet',
  silent: '',
};
