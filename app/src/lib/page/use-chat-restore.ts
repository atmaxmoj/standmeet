// use-chat-restore —— 刷新恢复:把后端 /sessions/history 的 Q&A 重建成已落地的
// Dialog 灌进 chat。从 use-chat.ts 拆出来守 350-line cap。splitParas 也搬这儿
// (use-chat 的 withAnswer 也用,反过来 import)。

'use client';

import { fetchHistory } from '@/lib/api/public';
import type { Dialog } from '@/lib/page/use-chat';

// splitParas —— body → 段落(连续空行分段;空 body → 空数组)。
export function splitParas(body: string): string[] {
  const trimmed = body.trim();
  return trimmed === ''
    ? []
    : trimmed.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p !== '');
}

// restoreHistory —— 凭 token 拉历史 Q&A → 重建 dialogs 灌 setter。有内容才灌
// (空就保持现状,跟没历史一样)。citation 暂空、time 历史没存留空。
export async function restoreHistory(
  token: string, setDialogs: (ds: Dialog[]) => void,
): Promise<void> {
  const ds = await fetchHistory(token);
  if (ds.length === 0) {
    return;
  }
  setDialogs(ds.map((d, i): Dialog => ({
    id: `h${i}`, q: d.question, time: '', pending: false,
    currentTool: null, toolCalls: [], retrying: false,
    answer: { paras: splitParas(d.answer), citations: [], private: false, byoaiBlocked: false },
  })));
}
