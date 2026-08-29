// UpgradePanel —— /admin/system 顶上那一格「升级」。
//
// 那个「check for updates」按钮以前**接不上**:没有 onClick,也没有后端可问。现在它问
// `instance.upgrade_check`,并且按答案决定自己变成什么 —— 判断都在 use-upgrade 的
// `upgradeView` 里(呈现层不含分支),这里只把它给的 key 交给 t()。
//
// 两条要害都写在那边:
//   · 只有真按得动的时候按钮才写「升级」。按不动的实例(没配重新部署的路)如实说,
//     并说清该怎么升 —— 提供一个做不到的动作比不提供更坏。
//   · 升过之后显示的是**量出来**的结果。后端只能报"请求打出去了";hook 通了、编排方也
//     重新部署了、而版本一个字没变(compose 把 tag 钉死了)是完全可能的。

'use client';

import { useTranslations } from 'next-intl';

import { useUpgrade, upgradeView } from '@/lib/admin/use-upgrade';
import { useAction } from '@/lib/ui/use-action';

export function UpgradePanel() {
  const t = useTranslations('adminShell.system');
  const u = useUpgrade();
  const run = useAction();
  const v = upgradeView(u);
  return (
    <div
      className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50 lg:col-span-2"
      data-testid="system-upgrade"
    >
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div
          className="mono text-[11.5px] leading-[1.7] text-(--color-muted) flex-1 min-w-[16rem]"
          data-testid="upgrade-line"
        >{t(v.lineKey, v.lineParams)}</div>
        <button
          type="button"
          data-testid="upgrade-button"
          disabled={v.busy}
          onClick={() => void run(() => v.canApply ? u.apply() : u.runCheck())}
          className="sm-btn sm-btn-outline sm-btn-sm shrink-0"
        >{t(v.buttonKey, v.buttonParams)}</button>
      </div>
    </div>
  );
}
