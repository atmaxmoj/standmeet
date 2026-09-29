// AnswerText —— renders one answer with formatting applied, for an author drawing their own chat
// with useChatSession. The model's answers carry markdown (`**bold**`, `` `code` ``, math); a
// host printing `text` verbatim shows the raw marks (F-O-8). This renders through the one chat
// renderer (chat/markdown.tsx — the transcript's own), so an answer looks the same here as in the
// app and in <Agent>.

import type { ReactNode } from 'react';

import { ChatMarkdown } from './chat/markdown.js';
import { splitParas } from './chat/dialog-stream.js';

export interface AnswerTextProps {
  text: string;
  /** Class for the paragraph (the host's own styling). */
  paragraphClassName?: string;
}

export function AnswerText({ text, paragraphClassName }: AnswerTextProps): ReactNode {
  return (
    <>
      {splitParas(text).map((p, i) => (
        <div key={i} className={paragraphClassName} data-testid="sm-answer-para">
          <ChatMarkdown source={p} />
        </div>
      ))}
    </>
  );
}
