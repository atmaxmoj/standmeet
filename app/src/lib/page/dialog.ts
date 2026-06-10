// dialog.ts —— 一个 dialog = visitor 问 + AI 答 (+ AI 引用了哪些 corpus)。
// turn 完成后 fire-and-forget 调 POST /sessions/{id}/dialogs 让 backend
// 落 transcript (admin /conversations 看的就是 dialog 历史)。
//
// D-5 后 visitor 走 browser pi-agent-core，backend 没经过 SendMessage 路径，
// 单靠 /inference/stream + /tools/{name} 不写 messages 表。本端补上。
// 失败不阻塞 UX (visitor 已经看到 reply)，logger.warn 即可。

import { logger } from '@/lib/logger';
import type { Citation, ToolCallView } from '@/lib/page/use-chat';

interface DialogSession {
  conversationID: string;
  sessionToken: string;
}

interface DialogPayload {
  body: string;
  citations: readonly Citation[];
  // toolCalls —— 本轮 AI 跑过的 tool 调用,随 dialog 一起落库(属于这段对话)。
  toolCalls: readonly ToolCallView[];
}

export async function recordDialog(
  sess: DialogSession, question: string, payload: DialogPayload,
): Promise<void> {
  const { wikiIDs, outputIDs } = splitCitations(payload.citations);
  try {
    const res = await fetch(
      `/api/v1/sessions/${sess.conversationID}/dialogs`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sess.sessionToken}`,
        },
        body: JSON.stringify({
          question,
          answer: payload.body,
          cited_wiki_ids: wikiIDs,
          cited_output_ids: outputIDs,
          tool_calls: payload.toolCalls,
        }),
      },
    );
    if (!res.ok && res.status !== 204) {
      logger.warn(`recordDialog: status ${res.status}`);
    }
  } catch (e) {
    logger.warn('recordDialog failed', e);
  }
}

function splitCitations(citations: readonly Citation[]): {
  wikiIDs: string[]; outputIDs: string[];
} {
  const wikiIDs: string[] = [];
  const outputIDs: string[] = [];
  for (const c of citations) {
    if (c.genre === 'wiki') wikiIDs.push(c.id);
    else outputIDs.push(c.id);
  }
  return { wikiIDs, outputIDs };
}
