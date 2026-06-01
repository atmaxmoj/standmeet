// persist-turn.ts —— D-5 regression fix: visitor pi-agent-core flow 不
// 走 backend /messages 端，turn 完成后单独 fire-and-forget 调一次
// POST /sessions/{id}/turns 让 owner 在 admin /conversations 看 transcript。
// 失败不阻塞 UX (visitor 已经看到 reply)，console.warn 即可。

import type { Citation } from '@/lib/page/use-conversation';

interface PersistTurnSession {
  conversationID: string;
  sessionToken: string;
}

interface PersistTurnPayload {
  body: string;
  citations: readonly Citation[];
}

export async function persistTurn(
  sess: PersistTurnSession, userText: string, payload: PersistTurnPayload,
): Promise<void> {
  const { wikiPaths, outputPaths } = splitCitations(payload.citations);
  try {
    const res = await fetch(
      `/api/v1/sessions/${sess.conversationID}/turns`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sess.sessionToken}`,
        },
        body: JSON.stringify({
          user_text: userText,
          assistant_text: payload.body,
          cited_wiki_paths: wikiPaths,
          cited_output_paths: outputPaths,
        }),
      },
    );
    if (!res.ok && res.status !== 204) {
      // eslint-disable-next-line no-console
      console.warn(`persistTurn: status ${res.status}`);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('persistTurn failed', e);
  }
}

function splitCitations(citations: readonly Citation[]): {
  wikiPaths: string[]; outputPaths: string[];
} {
  const wikiPaths: string[] = [];
  const outputPaths: string[] = [];
  for (const c of citations) {
    if (c.kind === 'wiki') wikiPaths.push(c.id);
    else outputPaths.push(c.id);
  }
  return { wikiPaths, outputPaths };
}
