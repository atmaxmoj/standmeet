// composer-attachments —— a long paste (a whole JD, say) shouldn't fill up
// the input box; instead it collapses into an "attachment" chip above the
// input. When the question is actually sent, the attachment's raw text gets
// spliced back into the message, so "everything I pasted stays in the
// conversation". Presentation layer bans logic, so the state machine +
// assembly live here.

import { useCallback, useRef, useState } from 'react';

import type { ClipboardEvent } from 'react';

// Pastes longer than this many characters become an attachment; below it,
// stays inline in the plain textarea (the box grows on its own). A JD is
// often well over a thousand characters, so 300 is enough to separate
// "long text" from "a single sentence".
export const PASTE_ATTACH_THRESHOLD = 300;

export interface Attachment {
  readonly id: string;
  readonly label: string;
  readonly content: string;
}

// attachmentLabel —— the summary shown on the chip: char count + line count
// + a preview of the first line.
export function attachmentLabel(content: string): string {
  const chars = content.length;
  const lines = content.split('\n').length;
  const size = chars >= 1000 ? `${(chars / 1000).toFixed(1)}k chars` : `${chars} chars`;
  const head = content.trim().split('\n')[0] ?? '';
  const preview = head.length > 48 ? `${head.slice(0, 48)}…` : head;
  return `${size} · ${lines} lines · ${preview}`;
}

// composeMessage —— when the question is sent, splices the typed text with
// each attachment's raw content into the final message. The question comes
// first, the pasted blocks after (with a separator marker), reading as
// "question + material I pasted" — both the LLM and the transcript get the
// full content.
export function composeMessage(typed: string, attachments: readonly Attachment[]): string {
  const t = typed.trim();
  if (attachments.length === 0) return t;
  const blocks = attachments
    .map((a, i) => `--- pasted text ${i + 1} ---\n${a.content}`)
    .join('\n\n');
  return t === '' ? blocks : `${t}\n\n${blocks}`;
}

export interface SplitMessage {
  // text —— the question itself (paste blocks stripped out); may be empty
  // (only material was pasted, nothing typed).
  readonly text: string;
  // pastes —— each paste block's raw text, rendered collapsed as details in
  // the transcript.
  readonly pastes: readonly string[];
}

// Inverts composeMessage: splits on the "--- pasted text N ---" marker. The
// first block's prefix might be the start of the string (no question) or
// \n\n (there is a question) — this matches both.
const PASTE_SPLIT = /(?:\n\n|^)--- pasted text \d+ ---\n/;

// splitComposedMessage —— the transcript splits a composed message back
// into {question, paste blocks[]}, so the "you" bubble shows the question +
// collapsed paste blocks instead of a wall of text. A message with no
// attachments → pastes is empty.
export function splitComposedMessage(q: string): SplitMessage {
  const [text = '', ...pastes] = q.split(PASTE_SPLIT);
  return { text: text.trim(), pastes };
}

interface ComposerAttachments {
  attachments: readonly Attachment[];
  hasAttachments: boolean;
  // onPaste —— a long paste prevents the default, becomes an attachment,
  // and returns true (the caller uses that to skip setInput); a short
  // paste returns false and lets it through inline.
  onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => boolean;
  remove: (id: string) => void;
  clear: () => void;
}

// useComposerAttachments —— the attachment state machine. ids use a
// monotonic counter (avoiding the nondeterminism of Math.random in
// SSR / tests); clear is called by the caller after a successful send.
export function useComposerAttachments(): ComposerAttachments {
  const [attachments, setAttachments] = useState<readonly Attachment[]>([]);
  const seq = useRef(0);

  const onPaste = useCallback((e: ClipboardEvent<HTMLTextAreaElement>): boolean => {
    const text = e.clipboardData.getData('text');
    if (text.length < PASTE_ATTACH_THRESHOLD) return false;
    e.preventDefault();
    seq.current += 1;
    const att: Attachment = {
      id: `paste-${seq.current}`,
      label: attachmentLabel(text),
      content: text,
    };
    setAttachments((prev) => [...prev, att]);
    return true;
  }, []);

  const remove = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clear = useCallback(() => setAttachments([]), []);

  return {
    attachments,
    hasAttachments: attachments.length > 0,
    onPaste,
    remove,
    clear,
  };
}
