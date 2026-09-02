// use-code-corpus —— a code's corpus access surface (the code-level layer of
// the corpus category among the ACL's three categories).
//
// A role grants the allow-list an audience can read; a code can only
// **subtract** further from it — what this particular invitation shouldn't
// see. Reads use the same payload of **a code's three denial categories**
// (corpus is just one of them; MCP reads this same payload), and writes
// touch only the corpus category: **a code can only subtract**, never grant
// what its role didn't already give (the pure AND of capability-acl-hierarchy A.4).

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';

// CodeDenialsSchema —— a code's three denial categories + what its role
// granted on the corpus (for comparison).
export const CodeDenialsSchema = z.object({
  capability_ids: z.array(z.string()),
  skill_ids: z.array(z.string()),
  // corpus_uris —— globs this code has withdrawn (empty = fully inherits the role).
  corpus_uris: z.array(z.string()),
  // corpus_granted —— the allow-list inherited from the role (read-only; change it under /admin/roles).
  corpus_granted: z.array(z.string()),
  // corpus_published_only —— the inherited role reads "whatever the owner has
  // published" (the public identity). It has **no** allow-list, so an empty
  // corpus_granted does not mean nothing is readable — the card must tell these two apart.
  corpus_published_only: z.boolean().nullish().transform((v) => v ?? false),
});
export type CodeDenials = z.infer<typeof CodeDenialsSchema>;

// CodeCorpus —— this surface only cares about the two halves of the corpus category.
export interface CodeCorpus {
  granted: string[];
  denied: string[];
  // publishedOnly —— the inherited role is the "published slice only" identity (public).
  publishedOnly: boolean;
}

function toCodeCorpus(d: CodeDenials): CodeCorpus {
  return {
    granted: d.corpus_granted,
    denied: d.corpus_uris,
    publishedOnly: d.corpus_published_only,
  };
}

export function fetchCodeCorpus(codeID: string): Promise<CodeCorpus> {
  return adminAPI.get(`/codes/${codeID}/denials`, CodeDenialsSchema).then(toCodeCorpus);
}

export function saveCodeCorpus(codeID: string, denied: string[]): Promise<CodeCorpus> {
  return adminAPI
    .put(`/codes/${codeID}/denials/corpus`, { uris: denied }, CodeDenialsSchema)
    .then(toCodeCorpus);
}
