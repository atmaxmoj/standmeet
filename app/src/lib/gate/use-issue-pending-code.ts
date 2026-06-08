// use-issue-pending-code —— defer-issue 模型的「开会点」。
//
// 扫码/链接进来只把 code 吸进 pending store、不立刻 issue session(见
// use-absorb-code)。名字选择器提交(或 skip)时才走这里:拿 pending code +
// 选好的名字真正 issueCodeSession —— 这样名字**真的进后端** = 一个人一个具名
// member = 一段续聊的会。name=null 表示 skip(匿名)。
//
// member_quota_reached(这张码名字数满了)→ 返 'full',picker 显 "code 已满"。

'use client';

import { useCallback, useState } from 'react';

import { issueCodeSession } from '@/lib/api/public';
import { persistSession } from '@/lib/gate/use-gate';
import { usePendingCodeStore } from '@/lib/gate/use-pending-code-store';
import { useVisitorSessionStore } from '@/lib/visitor/session-store';
import { useSuggestionsStore } from '@/lib/visitor/suggestions-store';

// IssueOutcome —— ok 成功;full 名字满了(picker 显 "code 已满");invalid 码无效
// /过期(丢掉 pending、回落 public);error 其它(网络抖动,保留 pending 可重试)。
export type IssueOutcome = 'ok' | 'full' | 'invalid' | 'error';

interface IssuePending {
  busy: boolean;
  issue: (name: string | null) => Promise<IssueOutcome>;
}

export function useIssuePendingCode(): IssuePending {
  const [busy, setBusy] = useState(false);
  const issue = useCallback(async (name: string | null): Promise<IssueOutcome> => {
    const code = usePendingCodeStore.getState().code;
    if (code === null) return 'error';
    setBusy(true);
    try {
      const sess = await issueCodeSession(name === null ? { code } : { code, visitor_name: name });
      persistSession(sess, false);
      useSuggestionsStore.getState().seed(sess.suggested_questions ?? []);
      useVisitorSessionStore.getState().setSession({
        code: sess.code ?? code,
        visitor: sess.visitor_name ?? null,
        byoai: false,
        byoaiProvider: '',
        label: null,
        used: sess.quota.used_turns,
        max: sess.quota.max_turns,
        maxMembers: sess.quota.max_members,
        memberCount: sess.members.length,
        startedAt: Date.now(),
      });
      usePendingCodeStore.getState().consume();
      return 'ok';
    } catch (e) {
      return classifyIssueError(e);
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, issue };
}

// classifyIssueError —— 403 名字满 → 'full'(保留 pending,picker 显满额);
// 401 码无效/过期 → 丢掉 pending(picker 隐藏)回落 public;其它 → 'error' 保留
// pending 让 visitor 重试。
function classifyIssueError(e: unknown): IssueOutcome {
  if (isStatus(e, 403)) return 'full';
  if (isStatus(e, 401)) {
    usePendingCodeStore.getState().consume();
    return 'invalid';
  }
  return 'error';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object';
}

// isStatus —— issueCodeSession 抛的 error 带后端 status(sdk client 挂的)。
function isStatus(e: unknown, status: number): boolean {
  return isRecord(e) && e['status'] === status;
}
