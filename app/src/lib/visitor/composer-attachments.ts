// composer-attachments —— 长粘贴(贴一整份 JD 之类)不该塞满输入框,而是收成
// 一枚「附件」chip 挂在输入框上方;真正发问时把附件原文完整拼回消息里,所以
// 「我贴的所有内容都保留在对话中」。presentation 层禁逻辑,状态机 + 拼装放这。

import { useCallback, useRef, useState } from 'react';

import type { ClipboardEvent } from 'react';

// 超过这个字符数的粘贴 → 转附件;以下走普通 textarea 内联(框会自己撑高)。
// 一份 JD 动辄上千字,300 足够把「长文」和「一句话」分开。
export const PASTE_ATTACH_THRESHOLD = 300;

export interface Attachment {
  readonly id: string;
  readonly label: string;
  readonly content: string;
}

// attachmentLabel —— chip 上显示的摘要:字数 + 行数 + 头一行预览。
export function attachmentLabel(content: string): string {
  const chars = content.length;
  const lines = content.split('\n').length;
  const size = chars >= 1000 ? `${(chars / 1000).toFixed(1)}k chars` : `${chars} chars`;
  const head = content.trim().split('\n')[0] ?? '';
  const preview = head.length > 48 ? `${head.slice(0, 48)}…` : head;
  return `${size} · ${lines} lines · ${preview}`;
}

// composeMessage —— 发问时把输入框文字 + 各附件原文拼成最终消息。问句在前、
// 粘贴块在后(带分隔标记),读起来是「问题 + 我贴的材料」,LLM 和 transcript
// 都拿到完整内容。
export function composeMessage(typed: string, attachments: readonly Attachment[]): string {
  const t = typed.trim();
  if (attachments.length === 0) return t;
  const blocks = attachments
    .map((a, i) => `--- pasted text ${i + 1} ---\n${a.content}`)
    .join('\n\n');
  return t === '' ? blocks : `${t}\n\n${blocks}`;
}

export interface SplitMessage {
  // text —— 问句本身(去掉粘贴块);可能为空(只贴了材料没打字)。
  readonly text: string;
  // pastes —— 各粘贴块原文,transcript 里折叠成 details 渲。
  readonly pastes: readonly string[];
}

// 反解 composeMessage:按 "--- pasted text N ---" 标记切。首块前缀可能是
// 行首(没问句)也可能是 \n\n(有问句),两种都吃。
const PASTE_SPLIT = /(?:\n\n|^)--- pasted text \d+ ---\n/;

// splitComposedMessage —— transcript 把 composed 消息拆回 {问句, 粘贴块[]},
// 让 you 气泡显问句 + 折叠的粘贴块,而不是一面文字墙。非附件消息 → pastes 空。
export function splitComposedMessage(q: string): SplitMessage {
  const [text = '', ...pastes] = q.split(PASTE_SPLIT);
  return { text: text.trim(), pastes };
}

interface ComposerAttachments {
  attachments: readonly Attachment[];
  hasAttachments: boolean;
  // onPaste —— 长粘贴 → 吃掉默认、转附件并返回 true(调用方据此跳过 setInput);
  // 短粘贴 → 返回 false 放行内联。
  onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => boolean;
  remove: (id: string) => void;
  clear: () => void;
}

// useComposerAttachments —— 附件状态机。id 用单调计数器(避免 Math.random
// 在 SSR / 测试里的不确定性),clear 在发送成功后由调用方调。
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
