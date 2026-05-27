export interface MarkdownStorage { getMarkdown(): string }

export function isMarkdownStorage(v: unknown): v is MarkdownStorage {
  return v !== null && typeof v === 'object' && 'getMarkdown' in v && typeof v.getMarkdown === 'function';
}

export function getMarkdownFromEditor(storage: object): string | undefined {
  if (!('markdown' in storage)) return undefined;
  const md: unknown = storage.markdown;
  return isMarkdownStorage(md) ? md.getMarkdown() : undefined;
}
