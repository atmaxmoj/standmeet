// use-post-composer —— the posts composer's state: the text, who will see it, the roles when that is
// "roles", and whether it can be posted now. Posting clears it; a refusal is reported, not swallowed.

'use client';

import { useState, type KeyboardEvent } from 'react';

import type { PostsHook, Visibility } from '@/lib/admin/use-posts';

export interface PostComposer {
  readonly body: string;
  readonly setBody: (update: (b: string) => string) => void;
  readonly vis: Visibility;
  readonly setVis: (v: Visibility) => void;
  readonly roleIDs: readonly string[];
  readonly setRoleIDs: (ids: string[]) => void;
  // ready —— there is text, nothing in flight, and a roles post names at least one role.
  readonly ready: boolean;
  readonly submit: () => void;
  // onKey —— ⌘/Ctrl + Enter posts, as in every compose box; a plain Enter is a new line.
  readonly onKey: (e: KeyboardEvent) => void;
}

export function canPost(body: string, vis: Visibility, roleIDs: readonly string[], busy: boolean): boolean {
  return !busy && body.trim() !== '' && (vis !== 'roles' || roleIDs.length > 0);
}

export function isSubmitKey(e: KeyboardEvent): boolean {
  return e.key === 'Enter' && (e.metaKey || e.ctrlKey);
}

export function usePostComposer(
  hook: PostsHook, onPosted: () => void, onError: (err: unknown) => void,
): PostComposer {
  const [body, setBodyState] = useState('');
  const [vis, setVis] = useState<Visibility>('private');
  const [roleIDs, setRoleIDs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const ready = canPost(body, vis, roleIDs, busy);
  const submit = () => {
    if (!ready) return;
    setBusy(true);
    hook.create({ body, visibility: vis, visible_role_ids: vis === 'roles' ? roleIDs : [] })
      .then(() => { setBodyState(''); setRoleIDs([]); onPosted(); }, onError)
      .finally(() => setBusy(false));
  };
  const onKey = (e: KeyboardEvent) => { if (isSubmitKey(e)) submit(); };
  return {
    body, setBody: (u) => setBodyState(u), vis, setVis, roleIDs, setRoleIDs, ready, submit, onKey,
  };
}
