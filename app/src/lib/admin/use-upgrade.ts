// use-upgrade —— /admin/system 那一格「升级」的数据层。
//
// 两件事,分得很开:
//   check()  这台实例跑着哪一版、发布了哪一版、它按不按得动
//   apply()  请编排方重新部署,**然后量结果**
//
// 量结果是要害。后端只能报"请求打出去了" —— 它自己就在被替换的东西里面,活不到能回答
// "升成功了没有"。而"打出去了"跟"升上去了"是两件事:hook 打通了、编排方也确实重新部署了,
// 但如果 compose 把镜像 tag 钉死,版本一个字都不会变。所以这里在浏览器端轮询
// /api/v1/instance 的 version —— 浏览器在重启中活着,它量得到。
//
// 量不到变化就如实说"重新部署过了,版本没变",不许因为 hook 返 200 就宣布升级成功。

'use client';

import { useCallback, useState } from 'react';
import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';

const UpgradeCheckSchema = z.object({
  current: z.string(),
  latest: z.string(),
  error: z.string(),
  comparable: z.boolean(),
  available: z.boolean(),
  can_apply: z.boolean(),
});
export type UpgradeCheck = z.infer<typeof UpgradeCheckSchema>;

// 重启预算:拉五张镜像 + 起完依赖,慢的机器上几分钟是正常的。
const POLL_BUDGET_MS = 300_000;
const POLL_EVERY_MS = 3_000;

export type UpgradePhase = 'idle' | 'checking' | 'applying' | 'settled';

// UpgradeOutcome —— apply() 之后**量出来**的结果,不是 hook 的返回码。
export type UpgradeOutcome =
  | { kind: 'upgraded'; version: string }
  | { kind: 'unchanged'; version: string }
  | null;

export interface UpgradeHook {
  check: UpgradeCheck | null;
  phase: UpgradePhase;
  outcome: UpgradeOutcome;
  runCheck: () => Promise<void>;
  apply: () => Promise<void>;
}

export function useUpgrade(): UpgradeHook {
  const [check, setCheck] = useState<UpgradeCheck | null>(null);
  const [phase, setPhase] = useState<UpgradePhase>('idle');
  const [outcome, setOutcome] = useState<UpgradeOutcome>(null);

  const runCheck = useCallback(async () => {
    setPhase('checking');
    try {
      setCheck(await adminAPI.get('/upgrade', UpgradeCheckSchema));
    } finally {
      setPhase('idle');
    }
  }, []);

  const apply = useCallback(async () => {
    const before = check?.current ?? '';
    setPhase('applying');
    setOutcome(null);
    try {
      await adminAPI.post('/upgrade', {}, z.object({ requested: z.boolean() }));
      setOutcome(await waitForRestart(before));
    } finally {
      setPhase('settled');
    }
  }, [check]);

  return { check, phase, outcome, runCheck, apply };
}

// waitForRestart —— 盯着 /api/v1/instance 的 version,直到它变了或预算用完。
// 重启途中请求会失败(容器正在换)—— 那是预期,不是结论,继续等。
async function waitForRestart(before: string): Promise<UpgradeOutcome> {
  const deadline = Date.now() + POLL_BUDGET_MS;
  let seen = before;
  while (Date.now() < deadline) {
    await sleep(POLL_EVERY_MS);
    const now = await liveVersion();
    if (now !== '' && now !== before) {
      return { kind: 'upgraded', version: now };
    }
    seen = now === '' ? seen : now;
  }
  return { kind: 'unchanged', version: seen };
}

// liveVersion —— 拿不到就返空串。空串是"这一拍没问到",不是"版本是空的"
// —— 两者混起来会让重启途中的一次失败被当成结论。
async function liveVersion(): Promise<string> {
  try {
    const res = await fetch('/api/v1/instance', { cache: 'no-store' });
    const body: unknown = res.ok ? await res.json() : {};
    return z.object({ version: z.string() }).catch({ version: '' }).parse(body).version;
  } catch {
    return '';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

// —— 面板显示什么 ——
//
// 分支在这里,不在组件里(跟 deployView / resourceStats 同一处):呈现层只把 key 交给 t()。
// 这也不只是为了过闸门 —— "按钮该不该写成升级"是一条**判断**,判断有了名字才验得了。

export interface UpgradeView {
  lineKey: string;
  lineParams: Record<string, string>;
  buttonKey: string;
  buttonParams: Record<string, string>;
  busy: boolean;
  canApply: boolean;
}

export function upgradeView(h: UpgradeHook): UpgradeView {
  const line = lineOf(h);
  return {
    lineKey: line.key,
    lineParams: line.params,
    buttonKey: buttonKeyOf(h),
    buttonParams: { version: h.check?.latest ?? '' },
    busy: h.phase === 'checking' || h.phase === 'applying',
    canApply: canApply(h.check),
  };
}

// canApply —— 有新版**而且**这台实例按得动。两个条件缺一不可:少了后一个,按钮就成了
// 一个按下去什么都不会发生的「升级」—— 那比没有这个按钮更坏。
function canApply(c: UpgradeCheck | null): boolean {
  return c !== null && c.available && c.can_apply;
}

function buttonKeyOf(h: UpgradeHook): string {
  if (h.phase === 'applying') { return 'upgradeApplying'; }
  if (h.phase === 'checking') { return 'upgradeChecking'; }
  return canApply(h.check) ? 'upgradeTo' : 'checkForUpdates';
}

interface Line { key: string; params: Record<string, string> }

// lineOf —— 结果优先于检查:升过一次之后,读者要看的是"到底升上去了没有"。
function lineOf(h: UpgradeHook): Line {
  if (h.outcome !== null) { return outcomeLine(h.outcome); }
  if (h.phase === 'applying') { return { key: 'upgradeWaiting', params: {} }; }
  return checkLine(h.check);
}

function outcomeLine(o: NonNullable<UpgradeOutcome>): Line {
  return o.kind === 'upgraded'
    ? { key: 'upgradeDone', params: { version: o.version } }
    : { key: 'upgradeStalled', params: { version: o.version } };
}

function checkLine(c: UpgradeCheck | null): Line {
  if (c === null) { return { key: 'upgradeUnknown', params: {} }; }
  if (c.error !== '') { return { key: 'upgradeUnreachable', params: {} }; }
  // 「比不了」不是「已经最新」。未盖章的构建(自己从源码 build 的)版本号不是发行号,
  // 报成"你已经是最新的"就是一句谎话 —— 照样把最新那一版说出来,让人自己判断。
  if (!c.comparable) {
    return { key: 'upgradeIncomparable', params: { version: c.latest, current: c.current } };
  }
  return c.available ? availableLine(c) : { key: 'upgradeCurrent', params: { version: c.current } };
}

// availableLine —— 有新版,但**这台实例按不按得动**决定说哪句话。按不动就说清为什么
// 以及该怎么升,不许含糊过去。
function availableLine(c: UpgradeCheck): Line {
  return {
    key: c.can_apply ? 'upgradeAvailable' : 'upgradeManual',
    params: { version: c.latest },
  };
}
