// corpus-read-wire.ts —— 把 corpus_read tool 的 result(unknown)安全解析成
// CorpusReadWire(id/path/genre/title/body)。纯 wire 解析,无 React / 无依赖,
// 从 use-chat 拆出来守 SRP:use-chat 负责事件累加,这层只管"读 corpus_read 形状"。

export interface CorpusReadWire {
  id: string;
  path: string;
  genre: string;
  title: string;
  body: string;
}

// pickCorpusReadShape —— corpus_read result → CorpusReadWire;形状不对 → null。
export function pickCorpusReadShape(raw: unknown): CorpusReadWire | null {
  if (!isRecord(raw)) return null;
  const id = readString(raw['id']);
  const path = readString(raw['path']);
  const genre = readString(raw['genre']);
  const title = readString(raw['title']) || path;
  const body = readString(raw['body']);
  return { id, path, genre, title, body };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object';
}

function readString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
