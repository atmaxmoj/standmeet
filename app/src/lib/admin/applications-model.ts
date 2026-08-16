// applications-model —— admin /applications 的数据形态 + timeline 派生 + 状态枚举。
//
// **状态说的是投递这条轴,不是 recruiter 回没回。**上一版这里是
// `silent | reviewing | replied | rejected | offer` —— 一套关于对方反应的词,而后端那一列存的是
// `pending | submitted | failed | withdrawn`,两套词一个都不重合。前端拿 `find(x => x === s)`
// 去对,永远对不上,于是每一行都被兜底渲染成 SILENT:一个纯属虚构的状态(F-E-3)。
//
// 今天的产品只知道投递这条轴,而且只知道它的第一格:`applications.commit` 写下一行(status
// 建出来就是 'pending' = owner 点了头、PDF 和邀请码已发),然后**没有任何代码会再改它** ——
// job-loop 第 4 步(Playwright 真投出去)还不存在,所以 submitted_at 一直是空的。
// recruiter 有没有回,产品连写入口都没有,那就不该有一个格子假装在跟踪它。
//
// 所以:能显示的只有 committed / submitted / failed / withdrawn,而没见过的值**原样显示**——
// 兜底成某个已知状态正是上一版制造假象的那一步。

import type { DraftModel } from '@/lib/admin/draft-model';

// SubmissionState —— 库里那一列的取值(见 jobsmodel/application.go)。'pending' 在界面上
// 叫 committed:owner 已经点头,只是还没投出去。
export type SubmissionState = 'committed' | 'submitted' | 'failed' | 'withdrawn';

export const SUBMISSION_STATES: readonly SubmissionState[] = [
  'committed', 'submitted', 'failed', 'withdrawn',
];

// STATE_BY_WIRE —— 后端字面量 → 界面词。缺席不是错误状态,是"没见过的值",见 submissionLabel。
const STATE_BY_WIRE: Record<string, SubmissionState> = {
  pending: 'committed',
  submitted: 'submitted',
  failed: 'failed',
  withdrawn: 'withdrawn',
};

// submissionLabel —— 没见过的值原样返回。宁可让 owner 看见一个陌生的字符串,
// 也不要把它说成某个具体状态。
export function submissionLabel(wire: string): string {
  return STATE_BY_WIRE[wire] ?? wire;
}

export interface Application {
  id: string;
  company: string;
  role: string;
  // committedAt —— owner 点头那一刻(applications 行的 created_at)。永远是真的。
  committedAt: string;
  // submittedAt —— 真投出去那一刻。空串 = 没有记录过(今天永远是空的)。
  submittedAt: string;
  // state —— 展示用的投递状态词;可能是一个没见过的原值。
  state: string;
  method: string;
  contact: string;
  notes: string;
  // resumeContent —— **发出去的那一份**。详情卡的 snapshot 那块渲的就是它。
  // 这里以前是 `resumeDelta: string`（"tailored 给该 job 的一句 punch"），而它在整个
  // 前端里从来只被赋成空串 —— 一个名字承诺内容、实际什么都不带的字段，于是那块
  // 只剩标题和一片空白（F-E-23）。
  resumeContent: DraftModel;
}

export interface TimelineEvent {
  t: string;
  label: string;
  kind: 'accent' | 'muted' | 'faint';
}

// timelineFor —— 只画**真**事件:commit(真日期)+ 投递(有日期才画,没有就明说没有记录)。
// 不编「6小时后被打开 / 次日 recruiter 回复」那种 mailbox-tracker 假步骤。
export function timelineFor(app: Application): TimelineEvent[] {
  return [
    { t: app.committedAt, label: 'committed · pdf + code issued', kind: 'accent' },
    app.submittedAt === ''
      ? { t: '—', label: 'submission not recorded', kind: 'faint' }
      : { t: app.submittedAt, label: 'submitted', kind: 'accent' },
  ];
}

// pillToneFor —— 列表行 status pill 的 tone class。抽到 lib/ 因为 presentation 层不准跑
// if / 复杂三元。没见过的值给空 tone(中性),不假装它属于哪一类。
export function pillToneFor(wire: string): string {
  return STATE_PILL_TONE[submissionLabel(wire)] ?? '';
}

const STATE_PILL_TONE: Record<string, string> = {
  committed: '',
  submitted: 'is-accent',
  failed: 'is-violet',
  withdrawn: 'is-violet',
};
