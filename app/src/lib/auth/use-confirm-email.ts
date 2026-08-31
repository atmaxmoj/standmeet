// use-confirm-email —— 点开确认链接之后那一下。业务判断在这里，呈现层只渲染。
//
// 三种结局刻意分开，因为 owner 下一步该做什么完全不同：
//   confirmed —— 换好了，去登录
//   expired   —— 链接过期了，回面板再点一次保存（**这条路还在**）
//   invalid   —— 这封信不是给你的 / 已经用过了
//
// 只回一个布尔的话，"过期"和"无效"会被压成同一句话，而那正是
// [[collapsed-error-class-kills-its-own-branch]]：为其中一种情况准备的那句指引永远出不来。

'use client';

import { useCallback, useEffect, useState } from 'react';

import { confirmEmail } from '@/lib/api/auth';

export type ConfirmEmailState =
  | { kind: 'working' }
  | { kind: 'confirmed'; email: string }
  | { kind: 'expired' }
  | { kind: 'invalid' };

// classifyConfirmError —— 后端的错误码决定说哪句话。认不出的码一律当 invalid：
// 一个我们没预料到的失败也不该渲染成"成功"。
function classifyConfirmError(code: string): ConfirmEmailState {
  return code === 'email_confirm_expired' ? { kind: 'expired' } : { kind: 'invalid' };
}

export function useConfirmEmail(token: string): ConfirmEmailState {
  const [state, setState] = useState<ConfirmEmailState>({ kind: 'working' });

  const run = useCallback(async (): Promise<void> => {
    // 没有 token 就别去问后端 —— 空 token 换回来的错误跟"这封信是编的"是同一句话，
    // 但我们在这里就知道答案。
    if (token === '') {
      setState({ kind: 'invalid' });
      return;
    }
    const res = await confirmEmail(token);
    setState(res.ok ? { kind: 'confirmed', email: res.email } : classifyConfirmError(res.code));
  }, [token]);

  useEffect(() => { void run(); }, [run]);
  return state;
}
