// vault-import-state.ts —— /admin/obsidian 那一行「上次导入」，由数据推出来（UX-62）。
//
// 照 `source-state.ts` 的写法，不新发明一种：两个兄弟页在说同一类事情 ——「这件事上次
// 发生是什么时候、结果如何」—— 声音就该一样（[[vocabulary-must-not-diverge]]）。
//
// **两种状态，不是一种**：
//   · 从没导过 → `never imported`
//   · 导过     → `last import · <日期> · 31 new · 20 updated`
//
// 「从没导过」跟「导过但零变更」必须分得开，所以哨兵是服务端给的 `never`，不是计数为 0。
// 推导住在这里而不是组件里：呈现层不写 if。

import { z } from 'zod';

export const VaultImportStateSchema = z.object({
  last_import_at: z.string().default(''),
  new: z.number().default(0),
  updated: z.number().default(0),
  skipped: z.number().default(0),
  // deleted —— 那一次剪掉了几条（F-L-62）。它跟另外三个数不是一类：新建/更新/未变都可逆，
  // 剪枝不可逆 —— 而这一行以前只报可逆的那三个。
  deleted: z.number().default(0),
  never: z.boolean(),
});

export type VaultImportState = z.infer<typeof VaultImportStateSchema>;

export function vaultImportLine(s: VaultImportState | null): string {
  if (s === null) return '';
  return s.never
    ? 'never imported'
    : `last import · ${s.last_import_at.slice(0, 10)} · ${changeSummary(s)}`;
}

// changeSummary —— 那一次到底动了什么。**skipped 也说**：一次「什么都没变」的导入
// 跟一次没发生过的导入，owner 要分得出来。
//
// **deleted 永远说，哪怕是 0**（F-L-62）：剪枝是这四个数里唯一不可逆的一个。零也是话
// ——「这次没剪」跟「这版根本不报剪枝」，owner 得分得出来，而后者正是这条缺陷的样子。
function changeSummary(s: VaultImportState): string {
  return `${s.new} new · ${s.updated} updated · ${s.deleted} deleted · ${s.skipped} unchanged`;
}
