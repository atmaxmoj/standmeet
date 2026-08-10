// SEOEditor —— wiki / output 共用的 public-landing SEO sub-section。
// 字段：excerpt / published。indexed=true 才进 sitemap + 渲染
// /wiki/<path> 或 /output/<path>。地址(path)纯树派生(标题 slug + parent 链),
// owner 不再自设 —— 所以这里没有 path 输入框,改名会同时改公开 URL。

'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { SEOUpdateInput } from '@/lib/admin/use-corpus-actions';

export interface SEOEditorInitial {
  excerpt: string;
  published: boolean;
}

export interface SEOEditorProps {
  testidPrefix: string;
  initial: SEOEditorInitial;
  busy: boolean;
  onSave: (input: SEOUpdateInput) => void;
}

export function SEOEditor(props: SEOEditorProps) {
  const state = useSEOState(props.initial);
  const onSave = () => props.onSave({
    excerpt: state.description,
    published: state.indexed,
  });
  return (
    <div className="space-y-3 border border-(--color-rule) p-4 bg-(--color-surface)/40 rounded-sm mt-3"
      data-testid={`${props.testidPrefix}-seo-form`}>
      <Heading />
      <DescriptionField state={state} testid={props.testidPrefix} />
      <IndexedField state={state} testid={props.testidPrefix} />
      <Actions busy={props.busy} onSave={onSave} testid={props.testidPrefix} />
    </div>
  );
}

interface SEOState {
  description: string;
  indexed: boolean;
  setDescription: (v: string) => void;
  setIndexed: (b: boolean) => void;
}

function useSEOState(initial: SEOEditorInitial): SEOState {
  const [description, setDescription] = useState(initial.excerpt);
  const [indexed, setIndexed] = useState(initial.published);
  return { description, indexed, setDescription, setIndexed };
}

function Heading() {
  const t = useTranslations('adminCorpus.seoEditor');
  return (
    <h4 className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">
      {t('heading')}
    </h4>
  );
}

function DescriptionField({ state, testid }: { state: SEOState; testid: string }) {
  const t = useTranslations('adminCorpus.seoEditor');
  return (
    <label className="block">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) block mb-1">
        {t('description')}
      </span>
      <textarea
        rows={2}
        value={state.description}
        onChange={(e) => state.setDescription(e.target.value)}
        spellCheck={false}
        placeholder="One-line summary for og:description"
        data-testid={`${testid}-seo-description`}
        className="w-full bg-transparent border border-(--color-rule) p-2 reading-tight text-[14px]"
      />
    </label>
  );
}

function IndexedField({ state, testid }: { state: SEOState; testid: string }) {
  const t = useTranslations('adminCorpus.seoEditor');
  return (
    <label className="flex items-baseline gap-2 mono text-[10.5px] tracking-[0.06em]">
      <input
        type="checkbox"
        checked={state.indexed}
        onChange={(e) => state.setIndexed(e.target.checked)}
        data-testid={`${testid}-seo-indexed`}
      />
      <span>{t('indexed')}</span>
    </label>
  );
}

interface ActionsProps {
  busy: boolean;
  onSave: () => void;
  testid: string;
}

// Actions —— 这张卡自己的提交。
//
// 这一屏上**有两个各自独立的 SAVE**：上面那张 CorpusEntryForm（正文/标签/封面）走 `onSubmit`，
// 这张 PUBLIC LANDING 卡走 `onSave`，两者提交的是不同的东西。而它们原本都只写 `save` ——
// owner 填完下半张卡，最自然的动作是去按上面那个更显眼的实心按钮，而那个按钮**不管这一半**
// （UX-60）。屏幕上没有边界提示、没有"未保存"标记，两个提交边界叠在一个滚动面里靠猜。
//
// 修法不是再加第三个"全部保存"按钮 —— 那会把两个后端调用藏进一个动作，更难说清。
// 让每个按钮**自己点名它管哪一半**：这是 owner 唯一能据以判断"我该按哪个"的信息。
function Actions(props: ActionsProps) {
  const t = useTranslations('adminCorpus.common');
  return (
    <div className="flex items-baseline justify-end pt-2">
      <button
        type="button"
        onClick={props.onSave}
        disabled={props.busy}
        data-testid={`${props.testid}-seo-save`}
        className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-2.5 py-1 hover:bg-(--color-accent) transition-colors disabled:opacity-40"
      >
        {props.busy ? t('saving') : t('saveLanding')}
      </button>
    </div>
  );
}
