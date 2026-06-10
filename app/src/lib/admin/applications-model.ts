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

// timelineFor —— 只画**真**事件:application sent(真 sentAt)+ 当前 status。
// 不再编「6小时后被打开 / 次日 recruiter 回复」那种 mailbox-tracker 假步骤
// (那需要 webhook 进 backend,还没接)。接通后这里加真 events。
export function timelineFor(app: Application): TimelineEvent[] {
  return [
    { t: app.sentAt, label: 'application sent', kind: 'accent' },
    { t: 'current', label: labelForStatus(app.status), kind: kindForStatus(app.status) },
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
