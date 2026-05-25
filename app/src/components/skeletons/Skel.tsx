// Skel —— 单一 skeleton 块。所有具体 skeleton 组件都拼这条 atom，css 在
// globals.css `.skel` 类里（pulse animation + color-mix grey）。
// class 推导挪 lib/state/skel-class.ts，让 component 复杂度 ≤3。

import { skelClass, type SkelProps } from '@/lib/state/skel-class';

export function Skel(props: SkelProps) {
  return <div aria-hidden className={skelClass(props)} />;
}
