// use-throbber-label —— G-8: 读 backend 下发的 tool spec progress_label。
// 没注册 / 空 → fallback "running <name>"。ConversationDeck / ChatRoom
// 共用此 hook，去掉两份硬编码 THROBBER_LABELS 重复。

import { useToolSpecsStore } from '@/lib/visitor/tool-specs-store';

export function useThrobberLabel(name: string): string {
  const label = useToolSpecsStore((s) => s.byName[name]?.progress_label);
  return label !== undefined && label !== '' ? label : `running ${name}`;
}
