// btn-styles —— Btn 的 size / kind 到 **`.sm-btn` 原子**的映射。
//
// 这里以前是第二套按钮实现:自己一份 BASE(mono/uppercase/tracking) + 自己一份 KIND_CLS
// (bg-ink / border-rule / muted),跟 `sm-atoms.css` 里的 `.sm-btn*` **并行存在**,
// 连词汇都不一样 —— 那边叫 `solid`,这边叫 `primary`。
//
// 代价不是"两份代码":`/admin/seo` 的 SAVE 写的是 `className="sm-btn sm-btn-primary"` ——
// **记着这一套的词汇,写进了那一套的命名空间**。`sm-btn-primary` 一条 CSS 都不生成,
// 于是那个主动作静默退回裸 `.sm-btn`,渲染得比它旁边的次要链接还轻(UX-74②)。
// 两套并存不只是重复,它**生产**这种错。
//
// 现在只有一套定义(CSS 原子),这里只做名字映射。`kind` 的取值也跟着改成原子的词:
// solid,不是 primary —— 一个概念一个词。
// 新的 variant 加在 `sm-atoms.css`,不加在这里。

import type { BtnKind, BtnSize } from '@/components/admin/atoms/Btn';

const SIZE_CLS: Record<BtnSize, string> = {
  sm: 'sm-btn-sm',
  md: '',
  lg: 'sm-btn-lg',
};

const KIND_CLS: Record<BtnKind, string> = {
  ghost:   'sm-btn-ghost',
  outline: 'sm-btn-outline',
  solid:   'sm-btn-solid',
  danger:  'sm-btn-danger',
};

export function resolveBtnClass(kind: BtnKind = 'ghost', size: BtnSize = 'md'): string {
  return `sm-btn ${KIND_CLS[kind]} ${SIZE_CLS[size]}`.trim();
}
