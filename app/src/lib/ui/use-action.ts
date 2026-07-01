// use-action —— 跑一个「owner 主动触发的 mutation」的默认收尾：成功 → success toast（可选），失败 →
// reportError（401 跳登录 / 其余 error toast）。取代满屏 `const ok = await x(); ok && toast.success(...)`
// —— 那个 idiom 只在成功时反馈，失败静默。mutation 现在**抛错**（不再吞成 false），这里统一接住。
//
//   const run = useAction();
//   run(() => hook.createCode(input), { success: 'Code created' });
//
// 需要非默认业务处理的（回滚乐观态、就地内联、冲突高亮、跳转到别处）——别用 run，调用方自己 try/catch。

'use client';

import { useCallback } from 'react';

import { useToast } from '@/lib/ui/toast';
import { useReportError } from '@/lib/ui/use-report-error';

interface ActionOpts {
  success?: string;
}

export function useAction(): (fn: () => Promise<unknown>, opts?: ActionOpts) => Promise<void> {
  const toast = useToast();
  const report = useReportError();
  return useCallback(async (fn: () => Promise<unknown>, opts?: ActionOpts) => {
    try {
      await fn();
      opts?.success !== undefined && toast.success(opts.success);
    } catch (e) {
      report(e);
    }
  }, [toast, report]);
}
