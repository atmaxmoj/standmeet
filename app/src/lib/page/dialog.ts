// dialog.ts —— 一个 dialog = visitor 问 + AI 答 (+ AI 引用了哪些 corpus)。
// turn 完成后 fire-and-forget 调 POST /sessions/{id}/dialogs 让 backend
// 落 transcript (admin /conversations 看的就是 dialog 历史)。
//
// D-5 后 visitor 走 browser pi-agent-core，backend 没经过 SendMessage 路径，
// 单靠 /inference/stream + /tools/{name} 不写 messages 表。本端补上。
// 失败不阻塞 UX (visitor 已经看到 reply)，logger.warn 即可。

import { logger } from '@/lib/logger';
import type { Citation } from '@/lib/page/use-chat';

interface DialogSession {
  conversationID: string;
  sessionToken: string;
}

interface DialogPayload {
  body: string;
  citations: readonly Citation[];
}

export async function recordDialog(
  sess: DialogSession, question: string, payload: DialogPayload,
): Promise<void> {
  const { wikiPaths, outputPaths } = splitCitations(payload.citations);
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
          cited_wiki_paths: wikiPaths,
          cited_output_paths: outputPaths,
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
  wikiPaths: string[]; outputPaths: string[];
} {
  const wikiPaths: string[] = [];
  const outputPaths: string[] = [];
  for (const c of citations) {
    if (c.genre === 'wiki') wikiPaths.push(c.path);
    else outputPaths.push(c.path);
  }
  return { wikiPaths, outputPaths };
}
