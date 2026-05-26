// use-shake-on-error —— 错码（或网络挂）触发 0.4s shake → 清空 + refocus。
// presentation 层不准跑 `if` / useEffect 的 control flow，所以抽到 lib/。
//
// 行为 mirror docs/design/project/gate.js CodeInput 的 setState('error')
// → setTimeout 1100ms → clear + focus；我们用 400ms 跟 .shake CSS 动画
// 时长对齐。

import { useEffect, useState } from 'react';

export function useShakeOnError(error: string | null, onShakeEnd: () => void): boolean {
  const [shake, setShake] = useState(false);
  useEffect(() => triggerShake(error, setShake, onShakeEnd),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onShakeEnd 是 inline closure，shake 只跟 error 边沿
    [error]);
  return shake;
}

function triggerShake(
  error: string | null,
  setShake: (v: boolean) => void,
  onShakeEnd: () => void,
): (() => void) | undefined {
  if (error === null) return undefined;
  setShake(true);
  const t = setTimeout(() => {
    setShake(false);
    onShakeEnd();
  }, 400);
  return () => clearTimeout(t);
}
