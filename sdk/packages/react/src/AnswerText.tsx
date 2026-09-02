// AnswerText —— renders one answer with formatting applied.
//
// Why the SDK has to ship this component (F-O-8): `useChatSession` hands the host
// **plain text**, but the model's answers are full of `**bold**` and `` `code` ``.
// The most naive host (printing `text` straight out) then shows the raw asterisks
// verbatim — the exact same symptom as F-O-6 on the web component, resurfacing on
// a different face. And the web component face already renders it: **two faces of
// the same SDK, one rendering, one not**.
//
// Parsing shares the core's `parseAnswerText`; this file only turns the result into
// React elements — all text nodes, no `dangerouslySetInnerHTML`, so there is no
// injection surface at all.

import { parseAnswerText } from '@standmeet/sdk-core';
import type { AnswerSpan } from '@standmeet/sdk-core';
import type { ReactNode } from 'react';

export interface AnswerTextProps {
  text: string;
  /** Class for the paragraph (the host's own styling). */
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
