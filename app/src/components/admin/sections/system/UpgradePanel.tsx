// UpgradePanel — the "upgrade" card at the top of /admin/system.
//
// The "check for updates" button used to be **unwired**: no onClick, no backend to ask.
// Now it calls `instance.upgrade_check` and decides what it becomes from the answer —
// all branching lives in use-upgrade's `upgradeView` (presentation layer has none);
// this component just hands the key it returns to t().
//
// Two things matter, both handled there:
//   - The button only says "upgrade" when it can actually be pressed. An instance with
//     no redeploy path wired says so honestly and states how to upgrade instead —
//     offering an action that can't work is worse than not offering it.
//   - What shows after upgrading is a **measured** result. The backend can only report
//     "the request went out"; the hook firing, the orchestrator redeploying, and the
//     version staying byte-for-byte unchanged (compose pins the tag) can all be true
//     at once.

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
