// use-connector-upload —— #155 区 G 上传编排：贴 spec+binding 上传一个 openapi 连接器。重名（同
// 品类已有）→ 先弹覆盖确认；确认 → 删旧建新（覆盖，不叠加）。品类从 binding 文本里抠（regex，
// 不在前端跑 YAML parser）。逻辑住这里，presentation 只渲染。

import { useCallback, useState } from 'react';

import type { ConnectorListHook } from '@/lib/admin/use-connector-list';
import { useReportError } from '@/lib/ui/use-report-error';

interface Pending { spec: string; binding: string; category: string }

export interface ConnectorUploadHook {
  pending: Pending | null;
  upload: (spec: string, binding: string) => void;
  confirmOverwrite: () => void;
  cancelOverwrite: () => void;
}

// bindingCategory —— 从 binding YAML 文本抠 category（`category: calendar`）。
function bindingCategory(binding: string): string {
  return binding.match(/^\s*category:\s*["']?([\w.-]+)/m)?.[1] ?? '';
}

export function useConnectorUpload(list: ConnectorListHook): ConnectorUploadHook {
  const [pending, setPending] = useState<Pending | null>(null);
  const report = useReportError();

  const upload = useCallback((spec: string, binding: string) => {
    const category = bindingCategory(binding);
    const exists = list.connectors.some((c) => c.category === category);
    exists
      ? setPending({ spec, binding, category })
      // 失败不能静默：create 抛错 → report 反显（不然上传像成功了却什么都没配上）。
      : void list.create({ specText: spec, bindingText: binding }).catch(report);
  }, [list, report]);

  const confirmOverwrite = useCallback(() => {
    const p = pending;
    const old = p === null ? undefined : list.connectors.find((c) => c.category === p.category);
    void (old === undefined ? Promise.resolve() : list.remove(old.id))
      .then(() => (p === null ? undefined : list.create({ specText: p.spec, bindingText: p.binding })))
      .catch(report) // 删旧/建新任一步失败 → report 反显（覆盖没生效 owner 必须知道）。
      .finally(() => setPending(null)); // 成败都收起确认框：失败也别把对话框卡死（list 内部各自 refresh）
  }, [pending, list, report]);

  const cancelOverwrite = useCallback(() => setPending(null), []);

  return { pending, upload, confirmOverwrite, cancelOverwrite };
}
