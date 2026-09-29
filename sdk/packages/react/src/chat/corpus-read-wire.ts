// corpus-read-wire.ts —— safely parses the corpus_read tool's result
// (unknown) into CorpusReadWire (id/path/genre/title/body). Pure wire
// parsing, no React / no dependencies, split out of use-chat to keep SRP:
// use-chat handles event accumulation, this layer only "reads the
// corpus_read shape".

export interface CorpusReadWire {
  id: string;
  path: string;
  // slug —— only writings have one. The public site addresses a writing by
  // slug (`/writings/<slug>`), while path is its position in the tree
  // (`writings/<slug>`, including the vault directory level). The two can't
  // substitute for each other: building a URL from path produces
  // `/writing/writings/…` in prod, a 404.
  slug: string;
  genre: string;
  title: string;
  body: string;
  // showAsSource —— the readCollector gate for wiki/output: false = readable
  // but excluded from the cited footer (meta/persona-type entries).
  // Defaults to true (only an explicit false hides it).
  showAsSource: boolean;
}

// pickCorpusReadShape —— corpus_read result → CorpusReadWire; wrong shape → null.
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

// citableCorpusRead —— whether this corpus_read belongs in the cited
// footer: only wiki/output/writing; wiki/output marked
// show_as_source=false (readCollector gate, matching the backend) are
// excluded; writing is a public blog, always included. Narrows genre for
// the caller to use directly.
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
