// use-shake-on-error —— a wrong code (or the network dying) triggers a
// 0.4s shake → clear + refocus. The presentation layer is not allowed to
// run `if` / useEffect control flow, so this is pulled out into lib/.
//
// Behavior mirrors docs/design/project/gate.js CodeInput's setState('error')
// → setTimeout 1100ms → clear + focus; we use 400ms to line up with the
// .shake CSS animation duration.

import { useEffect, useState } from 'react';

export function useShakeOnError(error: string | null, onShakeEnd: () => void): boolean {
  const [shake, setShake] = useState(false);
  useEffect(() => triggerShake(error, setShake, onShakeEnd),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onShakeEnd is an inline closure; the shake only follows the error edge
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
