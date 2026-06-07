// throbber-label —— tool_started → 人话进度文案。比 backend 的泛
// progress_label("reading entry")多显示「在读哪个文档」(path / query),
// 且动词轮换,让长 turn 的等待有信息感。presentation 层不准跑逻辑,所以放 lib。

const READ_VERBS = ['reading', 'pulling up', 'opening', 'checking', 'digging into'] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function readStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

type Formatter = (args: Record<string, unknown>, idx: number) => string;

// 带 document 的 formatter:用 tool args 里的 path / query。
const FORMATTERS: Record<string, Formatter> = {
  corpus_read: (a, i) => {
    const p = readStr(a['path']);
    return p ? `${READ_VERBS[i % READ_VERBS.length]!} ${p}` : 'reading an entry';
  },
  corpus_search: (a) => {
    const q = readStr(a['query']);
    return q ? `searching “${q}”` : 'searching the corpus';
  },
  corpus_list: () => 'browsing the corpus',
  summarize_conversation: () => 'writing a summary',
  ask_visitor: () => 'thinking how to ask',
};

// 前缀匹配的兜底文案(owner skill / 外部 MCP / calendar)。
const PREFIX_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['calendar', 'checking the calendar'],
  ['skill_', 'running a skill'],
  ['ext_', 'calling an external tool'],
];

// throbberLabel —— name + args(+ 该 tool 在本轮的序号,给动词轮换)→ 文案。
export function throbberLabel(name: string, args: unknown, idx: number): string {
  const a: Record<string, unknown> = isRecord(args) ? args : {};
  const fmt = FORMATTERS[name];
  if (fmt) {
    return fmt(a, idx);
  }
  const prefixed = PREFIX_LABELS.find(([p]) => name.startsWith(p));
  return prefixed ? prefixed[1] : `running ${name}`;
}
