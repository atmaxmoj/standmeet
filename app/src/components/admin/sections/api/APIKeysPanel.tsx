// APIKeysPanel —— /admin/api-mcp 上**外发 API key** 的那一块（F-K-1）。
//
// 跟同一页的 MCP keypair 列表是两种东西，别混（[[two-mcp-surfaces]]）：那边是 owner 自己的
// 客户端拿去签名的 Ed25519 keypair，这边是第三方程序拿去打 `/api/pub/v1` 的 `smk_` key。
//
// **为什么这一块必须存在**：在它之前外发 key 只长在 owner-MCP 上，于是一把泄露的 key
// 只有在 owner 装好并跑起一个 MCP 客户端之后才吊销得掉。止血的路不该要求先装工具。
// 设计本来就要两个面互为孪生（`docs/design/facade-directions.md:202-206`）。
//
// 明文只在铸出来那一次显示，之后列表里只剩 prefix —— 这一页不能变成一个能薅 key 的地方。

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { AdminSectionHead } from '@/components/admin/AdminSectionHead';
import { SelectField } from '@/components/atoms/SelectField';
import { useAPIKeys, type APIKeyItem } from '@/lib/admin/use-api-keys';
import { useRoles } from '@/lib/admin/use-roles';
import { useAction } from '@/lib/ui/use-action';

// INPUT_CLASS —— 这一页既有输入框的写法（下边框，不是四边框）。**照抄不发明**：
// 我第一版写了个 `sm-input`，那个类根本不存在，而 `check-sm-class-defined.sh` 正是为这种
// "名字看着像原子、其实什么都不生成"建的（[[computed-class-generates-nothing]]）。
const INPUT_CLASS =
  'w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 ' +
  'reading-tight text-base';

export function APIKeysPanel() {
  const t = useTranslations('adminIntegrations.apiKeys');
  const hook = useAPIKeys();
  const roles = useRoles();
  return (
    <div data-testid="api-keys-panel">
      <AdminSectionHead>{t('heading')}</AdminSectionHead>
      <p className="sm-measure text-[13px] text-(--color-muted) mb-3">{t('intro')}</p>
      <NewSecret created={hook.justCreated} onDismiss={hook.dismissCreated} />
      <MintRow
        hook={hook}
        roleIDs={roles.roles.map((r) => ({ id: r.id, name: r.name }))}
        fallbackRole={firstRoleID(roles.roles)}
      />
      <KeyList keys={hook.keys} hook={hook} />
    </div>
  );
}

// firstRoleID —— 取值,不是渲染;放在组件外面让呈现层守住 cyclo ≤3。
function firstRoleID(roles: readonly { id: string }[]): string {
  return roles[0]?.id ?? '';
}

// NewSecret —— 明文只出现这一次。文案要说清"再也拿不回来"，否则 owner 会以为待会儿还能看。
// **null 的分支自己接住**：让调用点保持无分支（呈现层 cyclo ≤3）。
function NewSecret(
  { created, onDismiss }: { created: { secret: string } | null; onDismiss: () => void },
) {
  const t = useTranslations('adminIntegrations.apiKeys');
  return created === null ? null : (
    <div className="border border-(--color-accent) p-3 mb-3">
      <div className="sm-smallcaps mb-1">{t('secretOnce')}</div>
      <code data-testid="api-key-new-secret" className="mono text-[12px] break-all block">
        {created.secret}
      </code>
      <button type="button" onClick={onDismiss} className="sm-btn sm-btn-ghost sm-btn-sm mt-2">
        {t('dismiss')}
      </button>
    </div>
  );
}

interface MintProps {
  hook: ReturnType<typeof useAPIKeys>;
  roleIDs: { id: string; name: string }[];
  // fallbackRole —— 角色还没选时用哪个。**父组件算好传下来**:呈现层守 cyclo ≤3,
  // 而"取第一个"那一步的分支放在这里就超了。
  fallbackRole: string;
}

function MintRow({ hook, roleIDs, fallbackRole }: MintProps) {
  const t = useTranslations('adminIntegrations.apiKeys');
  const [label, setLabel] = useState('');
  const [roleID, setRoleID] = useState('');
  const run = useAction();
  const mint = () => void run(async () => {
    await hook.createKey(label, roleID || fallbackRole);
    setLabel('');
  });
  return (
    <div className="flex items-end gap-3 mb-4 flex-wrap">
      <label className="flex-1 min-w-[180px]">
        <span className="sm-smallcaps block mb-1">{t('labelField')}</span>
        <input
          data-testid="api-key-new-label" value={label}
          onChange={(e) => { setLabel(e.target.value); }}
          className={INPUT_CLASS} placeholder={t('labelPlaceholder')}
        />
      </label>
      <label>
        <span className="sm-smallcaps block mb-1">{t('roleField')}</span>
        {/* SelectField 而不是裸 <select> —— 下拉只能有一种长相（UX-47 那条留下的闸门
            check-one-select 当场抓住了我）。 */}
        <SelectField
          testid="api-key-new-role" value={roleID}
          onChange={(e) => { setRoleID(e.target.value); }}
        >
          {roleIDs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </SelectField>
      </label>
      <button
        type="button" data-testid="api-key-new-create"
        // **没有角色可 assume 时不可点**。角色列表是异步来的，而这个按钮只要填了标签就亮；
        // 在列表回来之前点下去，`assumed_role_id` 是空串，后端必然 400 —— 一个**注定失败的
        // 可点按钮**（[[button-that-cannot-be-wired]]）。这不是竞态的补丁：没有角色的时候，
        // 铸一把 key 这件事本身就没有意义。
        disabled={label.trim() === '' || fallbackRole === ''}
        onClick={mint}
        className="sm-btn sm-btn-solid sm-btn-sm"
      >
        {t('mint')}
      </button>
    </div>
  );
}


function KeyList({ keys, hook }: { keys: readonly APIKeyItem[]; hook: ReturnType<typeof useAPIKeys> }) {
  const t = useTranslations('adminIntegrations.apiKeys');
  return keys.length === 0
    ? <div className="sm-empty mono text-[11px] text-(--color-faint)">{t('empty')}</div>
    : (
      <ul className="space-y-2">
        {keys.map((k) => <KeyRow key={k.id} row={k} hook={hook} />)}
      </ul>
    );
}

const ROW_BASE = 'flex items-baseline gap-3 border-b border-(--color-rule)/60 pb-2';

// rowCls —— 活着的行原样,吊销的行退浓度。
const rowCls = (live: boolean): string => (live ? ROW_BASE : `${ROW_BASE} opacity-55 saturate-50`);

// KeyRow —— 一把 key 一行。**只显示 prefix**，明文不在这儿。
//
// 吊销过的那一行**退到后面去**(UX-91,跟 codes 那边的 UX-88 同一条规矩):这张表回答的是
// 「现在谁的程序连得进来」,而吊销的行以前跟活着的行同样浓,只差一个词。退浓度不退内容 ——
// owner 还要能查一把旧 key 当初给了谁。
function KeyRow({ row, hook }: { row: APIKeyItem; hook: ReturnType<typeof useAPIKeys> }) {
  const t = useTranslations('adminIntegrations.apiKeys');
  const run = useAction();
  const live = row.status === 'active';
  return (
    <li className={rowCls(live)}>
      <span className="font-serif text-[15px] flex-1">{row.label}</span>
      <code className="mono text-[11px] text-(--color-muted)">{row.prefix}…</code>
      <span className="mono text-[10px] uppercase tracking-[0.14em] text-(--color-faint)">
        {live ? t('statusActive') : t('statusRevoked')}
      </span>
      {live ? (
        <button
          type="button" data-testid={`api-key-revoke-${row.label}`}
          // 吊销不可逆,所以先问一句 —— 跟 wiki 删除同一个惯例。
          onClick={() => {
            confirm(t('revokeConfirm'))
              && void run(async () => { await hook.revokeKey(row.id); });
          }}
          className="sm-btn sm-btn-ghost sm-btn-sm"
        >
          {t('revoke')}
        </button>
      ) : null}
    </li>
  );
}
