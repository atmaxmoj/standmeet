// use-conversations —— /admin/conversations 状态。
// backend 暂未暴露 GET /api/admin/conversations —— hook 直接返回 empty。
// 等接口出来后只换 fetch 路径即可。

import { useState } from 'react';

export interface ConvTurn {
  who: 'visitor' | 'ai';
  text: string;
  flagged?: boolean;
}

export interface ConvView {
  id: string;
  visitor: string;
  last: string;
  code: string;
  code_label: string;
  turns: number;
  private_hits: number;
  transcript?: ConvTurn[];
}

interface State {
  rows: ConvView[];
}

export interface ConversationsHook {
  rows: readonly ConvView[];
  openId: string | null;
  toggleOpen: (id: string) => void;
}

export function useConversations(): ConversationsHook {
  const [state] = useState<State>({ rows: [] });
  const [openId, setOpenId] = useState<string | null>(null);
  const toggleOpen = (id: string) => setOpenId((cur) => cur === id ? null : id);
  return { rows: state.rows, openId, toggleOpen };
}
