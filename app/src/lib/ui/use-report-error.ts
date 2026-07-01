// use-report-error —— 一个到 UI 的错误的**默认**反显策略，供 hook / 组件在 catch 里调：
//   const report = useReportError();
//   try { await hook.doThing(); } catch (e) { report(e); }
//
// 分流：会话过期(401) → 跳登录（toast 没意义，得重新认证）；其余 → error toast（后端 envelope 的
// 人话 message）。需要就地内联 / 冲突高亮 / 回滚乐观态 / 其它业务处理的场景，调用方自己在 catch 里
// 决定，不走这条默认。

'use client';

import { useCallback } from 'react';

import { APIError } from '@/lib/api/api-error';
import { useToast } from '@/lib/ui/toast';

const LOGIN_PATH = '/login';

export function useReportError(): (err: unknown) => void {
  const toast = useToast();
  return useCallback((err: unknown) => {
    if (err instanceof APIError && err.status === 401) {
      window.location.assign(LOGIN_PATH); // 会话过期 → 重新登录，而不是弹个 toast 让人干瞪眼
      return;
    }
    toast.error(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
  }, [toast]);
}
