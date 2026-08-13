// RoleDescriptionConfig —— role 卡上的 **description 编辑器**。description 过去只能在「+ NEW ROLE」
// 弹窗里写一次,role 建好后卡片上只把它当只读一行印出来,owner 再也改不了(owner 手工审计时发现:一个
// 名叫 D 的占位描述改不掉)。形态照抄 RoleDockConfig/RoleGhostConfig:卡上 inline 编辑 → 全量 PUT 回写
// (走 roleUpdatePayload,只表达 description 变,其余字段一律原样保留)。

import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';

import { roleUpdatePayload, useRoles, type RoleView } from '@/lib/admin/use-roles';
import { useAction } from '@/lib/ui/use-action';

export function RoleDescriptionConfig({ role }: { role: RoleView }) {
  const t = useTranslations('adminAccess');
  const roles = useRoles();
  const run = useAction();
  const [text, setText] = useState<string>(role.description);
  const onSave = useCallback(
    () => run(
      () => roles.updateRole(role.id, roleUpdatePayload(role, { description: text.trim() })),
      { success: `About updated for ${role.name}` },
    ),
    [role, roles, run, text],
  );
  return (
    <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-x-3 gap-y-1 items-start mt-0.5">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-faint) pt-1.5">
        {t('roleDesc.label')}
      </span>
      <div className="flex flex-col gap-1.5 min-w-0">
        {/* rows=2 **加** resize-none = owner 既看不到自己写的后半段，也拉不大。
            两个系统角色的 about 都是四五行散文，于是卡上那段在句子中间断掉
            （"…the code that goes out when you" 然后没了 —— 补图时在真环境上看见的）。
            这跟 UX-61 是同一类：编辑框比被编辑的东西小。 */}
        <textarea
          className="w-full min-w-0 bg-transparent border-b border-(--color-rule) py-1 reading-tight text-[13.5px] text-(--color-muted) resize-y"
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('roleDesc.placeholder')}
          data-testid={`role-desc-input-${role.name}`}
        />
        <button
          type="button"
          onClick={() => void onSave()}
          data-testid={`role-desc-save-${role.name}`}
          className="self-start mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-accent)"
        >
          {t('roleDesc.save', { name: role.name })}
        </button>
      </div>
    </div>
  );
}
