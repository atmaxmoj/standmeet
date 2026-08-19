// use-corpus-form —— CorpusEntryForm 的状态机。把 useState / useEffect /
// 字段计算从 .tsx 抽到 lib 让 presentation 层守 cyclo ≤ 3 + no-if 规则。
//
// retrieval-redesign 后 visibility 字段砍掉，准入靠 access_codes.corpus_permissions
// (path-glob ACL)。show_as_source 通过 admin SEO/path edit 路径独立设置，不在
// 主 form 里。

'use client';

import { useCallback, useEffect, useState } from 'react';

import { heroField } from '@/lib/admin/hero-field';
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
        // parent_id —— 后端现在也是**指针字段**（F-L-28）：不发 = 不动，发空串 = 挪到根。
        // 编辑表单不显示这一格，所以它一直不发，笔记的位置因此不动 —— 这正是要的。
        // **给编辑表单加父级控件的时候必须改这一行**：那时候「none (root)」得发空串，
        // 而不是像这里一样折成 undefined，否则那个选项按下去什么都不会发生。
        parent_id: parentID === '' ? undefined : parentID,
        // citable —— MUST be sent: the Go request struct decodes a missing `show_as_source` as
        // FALSE, so omitting it silently turned citation OFF on every edit (the note stayed
        // readable but stopped being attributable). Carry it explicitly.
        show_as_source: citable,
        // hero 三格发什么由 heroField 一处判(跟**载入时**的值比,不是跟空比) ——
        // 这样「他从没设过」和「他要撤掉」才分得开。
        cover_image_asset_id: heroField(coverAssetID, seed.coverAssetID),
        cover_headline: heroField(coverHeadline, seed.coverHeadline),
        cover_hue: heroField(coverHue, seed.coverHue),
      }),
      [
        title, body, tagsRaw, parentID, citable, coverAssetID, coverHeadline, coverHue,
        seed.coverAssetID, seed.coverHeadline, seed.coverHue,
      ],
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

// dropAssetRef —— 把正文里引用某份素材的**整张图**去掉，连同它前后多出来的空行。
//
// appendBlock 的另一半（F-L-50）：素材撤了而引用留在原地，访客页上就是一个裂图加一个
// 内部文件名，而 owner 在面板上看不见。删整个图片节点而不是只删地址 —— 只删地址会留下
// `![原文件名]()`，把文件名端给访客。
export function dropAssetRef(body: string, assetID: string): string {
  const re = new RegExp(
    '\\n*!\\[[^\\]]*\\]\\(\\s*standmeet-asset:' + assetID + '\\s*\\)\\n*', 'g',
  );
  return body.replace(re, '\n\n').replace(/\n{3,}/gu, '\n\n').trim();
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

// savedLine —— 一次保存的回执。**顺带做掉的事也要说**：取消发布一条被 pin 的条目会把它从
// 首页那几个栏目里摘掉，而 owner 是在「改一条笔记」的界面上做的，不去那一页根本不会知道
// （F-L-31）。没有连带时就是原来那句。
export function savedLine(unpinnedSections: readonly string[]): string {
  if (unpinnedSections.length === 0) {
    return 'saved';
  }
  return `saved — unpublishing also removed it from ${unpinnedSections.join(' and ')}`;
}
