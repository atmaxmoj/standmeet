// corpus-read-wire.ts —— 把 corpus_read tool 的 result(unknown)安全解析成
// CorpusReadWire(id/path/genre/title/body)。纯 wire 解析,无 React / 无依赖,
// 从 use-chat 拆出来守 SRP:use-chat 负责事件累加,这层只管"读 corpus_read 形状"。

export interface CorpusReadWire {
  id: string;
  path: string;
  // slug —— writings 才有。公开站按 slug 寻址一条 writing（`/writings/<slug>`），而 path
  // 是它在树里的位置（`writings/<slug>`，带 vault 那层目录）。两者不能互相顶替：
  // 拿 path 去拼地址，prod 上拼出来的是 `/writing/writings/…`，一个 404。
  slug: string;
  genre: string;
  title: string;
  body: string;
  // showAsSource —— wiki/output 的 readCollector gate:false = 能读但不进 cited
  // footer(meta/persona 类)。缺省视为 true(只有显式 false 才藏)。
  showAsSource: boolean;
}

// pickCorpusReadShape —— corpus_read result → CorpusReadWire;形状不对 → null。
export function pickCorpusReadShape(raw: unknown): CorpusReadWire | null {
  if (!isRecord(raw)) return null;
  const id = readString(raw['id']);
  const path = readString(raw['path']);
  const slug = readString(raw['slug']);
  const genre = readString(raw['genre']);
  const title = readString(raw['title']) || path;
  const body = readString(raw['body']);
  const showAsSource = raw['show_as_source'] !== false;
  return { id, path, slug, genre, title, body, showAsSource };
}

// citableCorpusRead —— 该 corpus_read 是否进 cited footer:只 wiki/output/writing;
// wiki/output 标 show_as_source=false(readCollector gate,跟后端一致)不进;writing
// 是 public blog,一律进。narrows genre 给 caller 直接用。
export function citableCorpusRead(
  r: CorpusReadWire,
): r is CorpusReadWire & { genre: 'wiki' | 'output' | 'writing' } {
  if (r.genre !== 'wiki' && r.genre !== 'output' && r.genre !== 'writing') return false;
  return !((r.genre === 'wiki' || r.genre === 'output') && !r.showAsSource);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object';
}

function readString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
