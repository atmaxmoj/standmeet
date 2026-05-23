// use-corpus-form —— CorpusEntryForm 的状态机。把 useState / useEffect /
// 字段计算从 .tsx 抽到 lib 让 presentation 层守 cyclo ≤ 3 + no-if 规则。

'use client';

import { useCallback, useEffect, useState } from 'react';

import type {
  CorpusEntryInput, PromoteInput,
} from '@/lib/admin/use-corpus-actions';

export type Visibility = 'public' | 'on_request' | 'private';

export interface CorpusFormHook {
  title: string;
  body: string;
  visibility: Visibility;
  tagsRaw: string;
  setTitle: (v: string) => void;
  setBody: (v: string) => void;
  setVisibility: (v: Visibility) => void;
  setTagsRaw: (v: string) => void;
  // 派生：当前不能 submit 的原因 ('' = 可以)
  submitDisabledReason: (busy: boolean, bodyVisible: boolean) => boolean;
  toEntryInput: (bodyVisible: boolean) => CorpusEntryInput;
  toPromoteInput: () => PromoteInput;
}

export function useCorpusForm(initial?: Partial<CorpusEntryInput>): CorpusFormHook {
  const seed = seedFromInitial(initial);
  const [title, setTitle] = useState(seed.title);
  const [body, setBody] = useState(seed.body);
  const [visibility, setVisibility] = useState<Visibility>(seed.visibility);
  const [tagsRaw, setTagsRaw] = useState(seed.tagsRaw);
  const key = JSON.stringify(initial ?? {});
  useEffect(() => {
    const next = seedFromInitial(initial);
    setTitle(next.title);
    setBody(next.body);
    setVisibility(next.visibility);
    setTagsRaw(next.tagsRaw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return {
    title, body, visibility, tagsRaw,
    setTitle, setBody, setVisibility, setTagsRaw,
    submitDisabledReason: useCallback(
      (busy: boolean, bodyVisible: boolean) =>
        submitDisabled(busy, bodyVisible, title, body),
      [title, body],
    ),
    toEntryInput: useCallback(
      (bodyVisible: boolean) => ({
        title: title.trim(),
        body: bodyVisible ? body : '',
        visibility,
        tags: parseTags(tagsRaw),
      }),
      [title, body, visibility, tagsRaw],
    ),
    toPromoteInput: useCallback(
      () => ({ title: title.trim(), visibility, tags: parseTags(tagsRaw) }),
      [title, visibility, tagsRaw],
    ),
  };
}

interface Seed {
  title: string;
  body: string;
  visibility: Visibility;
  tagsRaw: string;
}

function seedFromInitial(initial?: Partial<CorpusEntryInput>): Seed {
  return {
    title: initial?.title ?? '',
    body: initial?.body ?? '',
    visibility: initial?.visibility ?? 'public',
    tagsRaw: (initial?.tags ?? []).join(', '),
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
