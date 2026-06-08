// throbber-label —— tool_started → 人话进度文案。
//
// 设计:backend 给每个 tool 注册了 progress_label("searching corpus" /
// "booking meeting" / ...),那是 throbber 的**默认**文案。corpus 读类
// (corpus_read / corpus_search)在此之上**加上在读哪个文档**(path / query)+
// 动词轮换,让长 turn 的等待有信息感(owner: "他到底在读什么要展示一下,
// verb + document")。其它 tool(calendar / skill / ext)直接用 backend label,
// 不丢它原本就不错的 per-tool 文案。

const READ_VERBS = ['reading', 'pulling up', 'opening', 'checking', 'digging into'] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function readStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

type Formatter = (args: Record<string, unknown>, idx: number) => string;

// 只给 corpus 读类带 document 的增强 formatter;命中则覆盖 backend label。
const FORMATTERS: Record<string, Formatter> = {
  corpus_read: (a, i) => {
    const p = readStr(a['path']);
    return p ? `${READ_VERBS[i % READ_VERBS.length]!} ${p}` : 'reading an entry';
  },
  corpus_search: (a) => {
    const q = readStr(a['query']);
    return q ? `searching “${q}”` : 'searching the corpus';
  },
};

// throbberLabel —— name + args + backend progressLabel(+ 序号给动词轮换)。
// corpus 读类走带 document 的增强;否则用 backend label;再不行兜底。
export function throbberLabel(
  name: string, args: unknown, progressLabel: string | undefined, idx: number,
): string {
  const fmt = FORMATTERS[name];
  if (fmt) {
    return fmt(isRecord(args) ? args : {}, idx);
  }
  if (progressLabel !== undefined && progressLabel !== '') {
    return progressLabel;
  }
  return `running ${name}`;
}
