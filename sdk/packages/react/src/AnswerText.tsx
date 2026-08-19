// AnswerText —— 把一条答案渲成排版。
//
// 为什么 SDK 得给这个组件（F-O-8）：`useChatSession` 交给宿主的是**纯文本**，而模型的答案里
// 一路是 `**粗**` 和 `` `码` ``。最朴素的宿主（把 text 直接印出来）于是原样显示星号 ——
// 跟 F-O-6 在 web component 上的症状一模一样，换了个面又长出来一次。
// 而 web component 那一面已经渲了：**同一个 SDK 的两个面，一个渲一个不渲**。
//
// 解析共用 core 的 `parseAnswerText`，这里只负责变成 React 元素 —— 全是文本节点，
// 没有 `dangerouslySetInnerHTML`，注入面从根上不存在。

import { parseAnswerText } from '@standmeet/sdk-core';
import type { AnswerSpan } from '@standmeet/sdk-core';
import type { ReactNode } from 'react';

export interface AnswerTextProps {
  text: string;
  /** 段落的 class（宿主自己的排版）。 */
  paragraphClassName?: string;
}

export function AnswerText({ text, paragraphClassName }: AnswerTextProps): ReactNode {
  return (
    <>
      {parseAnswerText(text).map((spans, i) => (
        <p key={i} className={paragraphClassName} data-testid="sm-answer-para">
          {spans.map((s, j) => <Span key={j} span={s} />)}
        </p>
      ))}
    </>
  );
}

function Span({ span }: { span: AnswerSpan }): ReactNode {
  if (span.kind === 'bold') return <strong>{span.text}</strong>;
  if (span.kind === 'italic') return <em>{span.text}</em>;
  if (span.kind === 'code') return <code>{span.text}</code>;
  return <>{span.text}</>;
}
