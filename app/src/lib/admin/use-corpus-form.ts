// use-corpus-form —— CorpusEntryForm 的状态机。把 useState / useEffect /
// 字段计算从 .tsx 抽到 lib 让 presentation 层守 cyclo ≤ 3 + no-if 规则。
//
// retrieval-redesign 后 visibility 字段砍掉，准入靠 access_codes.corpus_permissions
// (path-glob ACL)。show_as_source 通过 admin SEO/path edit 路径独立设置，不在
// 主 form 里。

'use client';

import { useCallback, useEffect, useState } from 'react';

import type {
  CorpusEntryInput, PromoteInput,
} from '@/lib/admin/use-corpus-actions';

export interface CorpusFormHook {
  title: string;
  body: string;
  tagsRaw: string;
  parentID: string;
  setTitle: (v: string) => void;
  setBody: (v: string) => void;
  setTagsRaw: (v: string) => void;
  setParentID: (v: string) => void;
  // 派生：当前不能 submit 的原因 ('' = 可以)
  submitDisabledReason: (busy: boolean, bodyVisible: boolean) => boolean;
  toEntryInput: (bodyVisible: boolean) => CorpusEntryInput;
  toPromoteInput: () => PromoteInput;
}

export function useCorpusForm(initial?: Partial<CorpusEntryInput>): CorpusFormHook {
  const seed = seedFromInitial(initial);
  const [title, setTitle] = useState(seed.title);
  const [body, setBody] = useState(seed.body);
  const [tagsRaw, setTagsRaw] = useState(seed.tagsRaw);
  const [parentID, setParentID] = useState(seed.parentID);
  const key = JSON.stringify(initial ?? {});
  useEffect(() => {
    const next = seedFromInitial(initial);
    setTitle(next.title);
    setBody(next.body);
    setTagsRaw(next.tagsRaw);
    setParentID(next.parentID);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return {
    title, body, tagsRaw, parentID,
    setTitle, setBody, setTagsRaw, setParentID,
    submitDisabledReason: useCallback(
      (busy: boolean, bodyVisible: boolean) =>
        submitDisabled(busy, bodyVisible, title, body),
      [title, body],
    ),
    toEntryInput: useCallback(
      (bodyVisible: boolean) => ({
        title: title.trim(),
        body: bodyVisible ? body : '',
        tags: parseTags(tagsRaw),
        parent_id: parentID === '' ? undefined : parentID,
      }),
      [title, body, tagsRaw, parentID],
    ),
    toPromoteInput: useCallback(
      () => ({ title: title.trim(), tags: parseTags(tagsRaw) }),
      [title, tagsRaw],
    ),
  };
}

interface Seed {
  title: string;
  body: string;
  tagsRaw: string;
  parentID: string;
}

function seedFromInitial(initial?: Partial<CorpusEntryInput>): Seed {
  return {
    title: initial?.title ?? '',
    body: initial?.body ?? '',
    tagsRaw: (initial?.tags ?? []).join(', '),
    parentID: initial?.parent_id ?? '',
  };
}

function submitDisabled(
  busy: boolean, bodyVisible: boolean, title: string, body: string,
): boolean {
  const titleBlank = title.trim() === '';
  const bodyBlank = bodyVisible && body.trim() === '';
  return busy || titleBlank || bodyBlank;
}

function parseTags(raw: string): string[] {
  return raw.split(',').map((t) => t.trim()).filter((t) => t !== '');
}

// runWith —— action `Promise<boolean>` + toast + onDone 的"成功才收尾"helper。
// section 各处提交都走它，避免 presentation 层出现 `ok && (toast, onDone)`
// 这种 no-unused-expressions / 多语句 ternary。
export async function runWith(
  action: () => Promise<boolean>,
  onSuccess: () => void,
): Promise<void> {
  const ok = await action();
  if (ok) onSuccess();
}
