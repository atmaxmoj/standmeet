// corpus.ts —— helper for seeding corpus via MCP (specs use it to give the
// retrieval agent something to search).
//
// The tools are corpus.create / corpus.promote, with genre as a **parameter**;
// the primary key is uniformly called id. Before normalization these were three
// tools (raw_dump / promote_to_wiki / promote_wiki_to_output) and three primary
// key names (raw_id / wiki_id / output_id).
//
// Fields after the redesign:
//   • path —— the unique identifier (replacing seo_slug). Retrieval ACL is
//     evaluated by path-glob.
//   • show_as_source —— when false the AI can read it but it isn't counted in the
//     cited footer.
//   • the visibility field was cut —— admission is via corpus_permissions on the
//     access code.

import type { APIRequestContext } from '@playwright/test';

import { callTool } from '@/fixtures/mcp';

// The shape of a corpus entry on every surface: the primary key is id (same for
// all three genres), with genre as a parameter. Before normalization this read
// three different names: raw_id / wiki_id / output_id.
interface CorpusEntry { id: string }

export interface SeedWikiOpts {
  body: string;
  title: string;
  path?: string;
  showAsSource?: boolean;
}

export async function seedWiki(
  request: APIRequestContext,
  apiToken: string,
  sessionId: string,
  opts: SeedWikiOpts,
): Promise<{ rawID: string; wikiID: string }> {
  // The address is tree-derived (the slugified title of each segment of the
  // parent chain). Given a multi-segment path like 'projects/lucerna', first
  // build out the parent-node chain (title = each segment) so the leaf's tree
  // path reconstructs to this path —— that way the spec's path assertions + ACL
  // glob don't change. The leaf still writes a flat-column path (the admin
  // transcript still reads that column for now; see task #8's remaining surfaces).
  const parentID = await seedParentChain(request, apiToken, sessionId, opts.path);
  // mkdir -p semantics at the leaf: reuse an existing entry with the same name
  // under the same parent —— on write, same-slug siblings are rejected by the
  // backend (Obsidian semantics), so seeding the same note multiple times in one
  // describe shouldn't collide.
  const existing = await findExistingChild(request, apiToken, sessionId, opts.title, parentID);
  if (existing !== '') return { rawID: '', wikiID: existing };
  const dump = await callTool<CorpusEntry>(
    request, apiToken, sessionId, 'corpus.create',
    { genre: 'raw', body: opts.body, source: 'mcp:e2e', tags: [] },
  );
  const args: Record<string, unknown> = {
    genre: 'raw', id: dump.id, title: opts.title,
  };
  if (opts.path) args['path'] = opts.path;
  if (parentID !== '') args['parent_id'] = parentID;
  if (opts.showAsSource === false) args['show_as_source'] = false;
  const promoted = await callTool<CorpusEntry>(
    request, apiToken, sessionId, 'corpus.promote', args,
  );
  return { rawID: dump.id, wikiID: promoted.id };
}

// seedParentChain —— path 'a/b/leaf' → build the two parent nodes a and b
// (title = segment), returning the last parent's wiki_id (the leaf hangs under
// it). Single-segment / no path → returns '' (the leaf is root).
//
// mkdir -p semantics: if a parent segment already exists (same name under the
// same parent), reuse it rather than rebuild —— on write, same-slug siblings are
// rejected by the backend (Obsidian semantics), so not reusing would collide on
// shared prefixes.
async function seedParentChain(
  request: APIRequestContext, apiToken: string, sessionId: string, path?: string,
): Promise<string> {
  const segments = (path ?? '').split('/').filter((s) => s !== '');
  let parentID = '';
  for (const seg of segments.slice(0, -1)) {
    const existing = await findExistingChild(request, apiToken, sessionId, seg, parentID);
    if (existing !== '') { parentID = existing; continue; }
    const dump = await callTool<CorpusEntry>(
      request, apiToken, sessionId, 'corpus.create',
      { genre: 'raw', body: seg, source: 'mcp:e2e', tags: [] },
    );
    const args: Record<string, unknown> = { genre: 'raw', id: dump.id, title: seg };
    if (parentID !== '') args['parent_id'] = parentID;
    const promoted = await callTool<CorpusEntry>(
      request, apiToken, sessionId, 'corpus.promote', args,
    );
    parentID = promoted.id;
  }
  return parentID;
}

interface WikiRow { id: string; title: string; parent_id: string | null }

// findExistingChild —— under parentID (''=root), find an existing node with an
// exactly matching title and return its id; '' if none. Lets seedParentChain
// reuse the parent chain instead of rebuilding into a name collision.
async function findExistingChild(
  request: APIRequestContext, apiToken: string, sessionId: string,
  title: string, parentID: string,
): Promise<string> {
  const rows = await callTool<WikiRow[]>(
    request, apiToken, sessionId, 'corpus.list', { genre: 'wiki', limit: 200 },
  );
  const wantParent = parentID === '' ? null : parentID;
  const hit = rows.find((r) => r.title === title && (r.parent_id ?? null) === wantParent);
  return hit?.id ?? '';
}

// publishEntry —— set a corpus entry public (wiki / output share one op, genre is
// a parameter).
//
// Nine specs each copied this call, so renaming the tool meant changing nine
// places. One call, one place to change.
export async function publishEntry(
  request: APIRequestContext,
  apiToken: string,
  sessionId: string,
  opts: { genre: 'wiki' | 'output'; id: string; excerpt?: string },
): Promise<void> {
  await callTool<unknown>(request, apiToken, sessionId, 'seo.set_entry_seo', {
    genre: opts.genre, id: opts.id, excerpt: opts.excerpt ?? '', published: true,
  });
}

// seedPublicWiki —— the legacy spec entry point; after the retrieval redesign the
// path field is the primary identifier, but old spec callers have no path input
// yet, so this helper auto-uses a wiki/<random> path (after the redesign the
// backend derives the same). The tags field is kept as an input but ignored ——
// retrieval ACL goes by path-glob, tag admission no longer applies.
//
// After [[path-rename-migration]] is done, the owner can sweep these callers
// again and switch them to explicit seedWiki + path arguments.
export async function seedPublicWiki(
  request: APIRequestContext,
  apiToken: string,
  sessionId: string,
  opts: { body: string; title: string; tags?: string[] },
): Promise<{ rawID: string; wikiID: string }> {
  return seedWiki(request, apiToken, sessionId, {
    body: opts.body, title: opts.title,
  });
}
