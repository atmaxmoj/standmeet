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
  citable: boolean;
  // hero 三件套 —— 图 + 压在图上那句话 + 色调。**三样都要能在面板上写**:
  // 只做图那一样的话,owner 设完封面看到的是标题被顶上去当 headline,而他没有任何
  // 办法改它(除非去 AI 客户端调 MCP)。访客那侧三样都渲。
  //
  // 跟正文一起存,**不单独 PATCH**:corpus.update 对除 hero 之外的字段是整份替换,
  // 只发一个 cover 会把标题和正文清成空的。
  coverAssetID: string;
  coverHeadline: string;
  coverHue: string;
  setTitle: (v: string) => void;
  setBody: (v: string) => void;
  setTagsRaw: (v: string) => void;
  setParentID: (v: string) => void;
  setCitable: (b: boolean) => void;
  setCoverAssetID: (v: string) => void;
  setCoverHeadline: (v: string) => void;
  setCoverHue: (v: string) => void;
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
  const [citable, setCitable] = useState(seed.citable);
  const [coverAssetID, setCoverAssetID] = useState(seed.coverAssetID);
  const [coverHeadline, setCoverHeadline] = useState(seed.coverHeadline);
  const [coverHue, setCoverHue] = useState(seed.coverHue);
  const key = JSON.stringify(initial ?? {});
  useEffect(() => {
    const next = seedFromInitial(initial);
    setTitle(next.title);
    setBody(next.body);
    setTagsRaw(next.tagsRaw);
    setParentID(next.parentID);
    setCitable(next.citable);
    setCoverAssetID(next.coverAssetID);
    setCoverHeadline(next.coverHeadline);
    setCoverHue(next.coverHue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return {
    title, body, tagsRaw, parentID, citable, coverAssetID, coverHeadline, coverHue,
    setTitle, setBody, setTagsRaw, setParentID, setCitable, setCoverAssetID,
    setCoverHeadline, setCoverHue,
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
        // citable —— MUST be sent: the Go request struct decodes a missing `show_as_source` as
        // FALSE, so omitting it silently turned citation OFF on every edit (the note stayed
        // readable but stopped being attributable). Carry it explicitly.
        show_as_source: citable,
        // hero 在后端是**指针字段**:不发 = 不动,发空串 = 清掉。所以只在编辑态(表单
        // 真的载到过一个值,或 owner 刚点了封面)才发它 —— 新建表单发空串会把
        // "没设过封面"写成"明确清空",两者在后端不是同一件事。
        cover_image_asset_id: coverAssetID === '' ? undefined : coverAssetID,
        cover_headline: coverHeadline === '' ? undefined : coverHeadline,
        cover_hue: coverHue === '' ? undefined : coverHue,
      }),
      [title, body, tagsRaw, parentID, citable, coverAssetID, coverHeadline, coverHue],
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
  citable: boolean;
  coverAssetID: string;
  coverHeadline: string;
  coverHue: string;
}

function seedFromInitial(initial?: Partial<CorpusEntryInput>): Seed {
  return {
    title: initial?.title ?? '',
    body: initial?.body ?? '',
    tagsRaw: (initial?.tags ?? []).join(', '),
    parentID: initial?.parent_id ?? '',
    // 缺省 true = 跟 DB 的 `show_as_source NOT NULL DEFAULT true` 一致：新条目默认可引用。
    citable: initial?.show_as_source ?? true,
    coverAssetID: initial?.cover_image_asset_id ?? '',
    coverHeadline: initial?.cover_headline ?? '',
    coverHue: initial?.cover_hue ?? '',
  };
}

function submitDisabled(
  busy: boolean, bodyVisible: boolean, title: string, body: string,
): boolean {
  const titleBlank = title.trim() === '';
  const bodyBlank = bodyVisible && body.trim() === '';
  return busy || titleBlank || bodyBlank;
}

// appendBlock —— 往正文末尾接一段,中间留一个空行。**接在后面,不覆盖** ——
// owner 点"插入"是想加一张图,不是想让已经写好的正文消失。
export function appendBlock(body: string, block: string): string {
  if (body.trim() === '') return block;
  return `${body.replace(/\s+$/u, '')}\n\n${block}`;
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
