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
import { seedEphemeralStores } from '@/lib/page/use-chat-restore';
import {
  loadMemberID, rememberMemberID, rememberVisitorName, rememberVisitorEmail,
} from '@/lib/visitor/visitor-name';

// IssueOutcome —— ok 成功;full 名字满了(picker 显 "code 已满");invalid 码无效
// /过期(丢掉 pending、回落 public);error 其它(网络抖动,保留 pending 可重试)。
export type IssueOutcome = 'ok' | 'full' | 'invalid' | 'error';

// submitPickerName —— 名字选择器 START 的决策。名字跟当前 session 一样 → 续聊:
// 只关窗(consume pending),**不 re-issue** —— 后端本就同 member 同 open chat,
// re-issue 反而触发前端 startedAt-reset 清屏 + issue 响应 used_turns=0 看着像归零。
// 名字不一样 / 还没 session → 真 issue(新名字 = 新 member = 新对话)。
export async function submitPickerName(
  name: string, email: string,
  issue: (name: string | null, email: string) => Promise<IssueOutcome>,
): Promise<IssueOutcome> {
  const trimmed = name.trim();
  const current = useVisitorSessionStore.getState().session?.visitor ?? null;
  if (current !== null && trimmed === current) {
    usePendingCodeStore.getState().consume();
    return 'ok';
  }
  rememberVisitorName(trimmed);
  rememberVisitorEmail(email.trim());
  return issue(trimmed, email.trim());
}

// dismissPicker —— skip / 点窗外。已有 session(换人窗)→ 取消,保持原 session
// (consume,不 issue 匿名,免得凭空多一个 guest member + 新对话)。还没 session
// (首次)→ skip = 匿名 issue。
export async function dismissPicker(
  issue: (name: string | null, email: string) => Promise<IssueOutcome>,
): Promise<IssueOutcome> {
  if (useVisitorSessionStore.getState().session !== null) {
    usePendingCodeStore.getState().consume();
    return 'ok';
  }
  return issue(null, '');
}

interface IssuePending {
  busy: boolean;
  issue: (name: string | null, email: string) => Promise<IssueOutcome>;
}

export function useIssuePendingCode(): IssuePending {
  const [busy, setBusy] = useState(false);
  const issue = useCallback(async (name: string | null, email: string): Promise<IssueOutcome> => {
    const code = usePendingCodeStore.getState().code;
    if (code === null) return 'error';
    setBusy(true);
    try {
      // 具名:按名字解析(名字就是身份,改名能改人)。匿名(skip):带上次存的
      // member_id 续会(没有就后端新建一个独立 guest member)。email 可选。
      const sess = await issueCodeSession(
        name === null
          ? { code, member_id: loadMemberID() || undefined }
          : { code, visitor_name: name, visitor_email: email || undefined },
      );
      persistSession(sess, false);
      // F-A-20: this in-page re-issue (switch-name picker) must reseed ALL the ephemeral chat stores
      // from the just-persisted session — dock buttons / tool specs / capabilities, not only ghosts.
      // Gate-entry masked the bug because it ends in a navigation (mount → seedEphemeralStores); the
      // in-page switch does not, so without this the new session's dock stayed empty until a reload.
      seedEphemeralStores();
      useVisitorSessionStore.getState().setSession({
        code: sess.code ?? code,
        visitor: sess.visitor_name ?? null,
        byoai: false,
        byoaiProvider: '',
        // 换名字重开会话也要带上这张码的名字 —— 否则 strip 会在换人之后退回兜底（UX-68）。
        label: sess.code_label ?? null,
        used: sess.quota.used_turns,
        max: sess.quota.max_turns,
        maxMembers: sess.quota.max_members,
        memberCount: sess.members.length,
        startedAt: Date.now(),
        email: email || '',
        ownerCanDeliver: sess.owner_can_deliver ?? false,
      });
      // 匿名:把后端给的 member_id 存下,下次 skip 凭它续同一个 guest member。
      if (name === null) {
        rememberMemberID(sess.member_id ?? '');
      }
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
