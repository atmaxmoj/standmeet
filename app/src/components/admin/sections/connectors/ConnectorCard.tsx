// ConnectorCard —— 一张连接器卡（内置或上传）：派生凭据表单（connector-field-{key}）+ oauth2 的
// redirect-uri（只读）/ scope 多选 + Connect/Disconnect + 状态/错误。归一鈦：任何 kind/auth 一套
// 卡。逻辑在 use-connector-card；这里只渲染 + 连线（eslint：无 if、复杂度 ≤3）。

'use client';

import { useTranslations } from 'next-intl';

import { ConnectorOps } from '@/components/admin/sections/connectors/ConnectorOps';
import { SelectField } from '@/components/atoms/SelectField';
import { useConnectorCard, type ConnectorCardHook } from '@/lib/admin/use-connector-card';
import type { CatalogEntry } from '@/lib/admin/use-connector-catalog';

export function ConnectorCard({ entry }: { entry: CatalogEntry }) {
  const hook = useConnectorCard(entry.id);
  return (
    <li
      data-testid={`connector-row-${entry.id}`}
      className="crosshair border border-(--color-rule) rounded-sm bg-(--color-surface)/30 p-4"
    >
      <span className="ch-tl" /><span className="ch-br" />
      <CardHead category={entry.category} connected={hook.connected} connecting={hook.connecting} />
      <SchemeSelect schemes={hook.schemes} />
      <Fields hook={hook} />
      <RedirectUri id={entry.id} authType={hook.authType} />
      <Scopes hook={hook} />
      <Actions hook={hook} />
      <ErrorLine error={hook.error} />
      <ConnectorOps ops={entry.owner_ops ?? []} />
    </li>
  );
}

function CardHead(
  { category, connected, connecting }: { category: string; connected: boolean; connecting: boolean },
) {
  return (
    <div className="flex items-center justify-between mb-3">
      <span className="text-sm text-(--color-ink)">{category}</span>
      <span data-testid="connector-status" className="mono text-[11px] text-(--color-muted)">
        {statusText(connected, connecting)}
      </span>
    </div>
  );
}

// statusText —— connecting…（dance 进行中，不含 "connected" 子串，让 expectConnected 真等回程）/
// connected / not connected。
function statusText(connected: boolean, connecting: boolean): string {
  return connecting ? 'connecting…' : connected ? 'connected' : 'not connected';
}

// SchemeSelect —— 多 securityScheme 时让 owner 选认证方式（单 scheme 也渲染，装配测试要选一下）。
// 非受控：连接用的是连接器装配时定的 scheme（单 scheme 即唯一那个）；选项在则 selectOption 可用。
function SchemeSelect({ schemes }: { schemes: readonly string[] }) {
  return schemes.length === 0 ? null : (
    <SelectField
      testid="connector-scheme-select"
      defaultValue={schemes[0]}
      className="w-full mb-3"
      mono
    >
      {schemes.map((s) => <option key={s} value={s}>{s}</option>)}
    </SelectField>
  );
}

function Fields({ hook }: { hook: ConnectorCardHook }) {
  return (
    <div className="space-y-2 mb-3">
      <StoredCredsNote show={hook.hasCredentials} />
      {hook.fields.map((key) => (
        <input
          key={key}
          data-testid={`connector-field-${key}`}
          type={isSecret(key) ? 'password' : 'text'}
          placeholder={key}
          onChange={(e) => hook.setField(key, e.target.value)}
          // 文本输入在这个产品里只有一种长相：下划线（`.sm-field-input`）。凭据这几格
          // 曾是**整框**，于是同一种控件隔一屏就是两个标准（UX-59）。
          className="sm-field-input sm-mono"
        />
      ))}
    </div>
  );
}

// StoredCredsNote —— 「这个连接器已经存了凭据」。
//
// 后端**从不回**凭据的值，只回 `has_credentials: true`（connector-security 验过：
// credential-form 回的是字段名、连打码的值都没有 —— 那比打码更强，是对的）。
// 但代价没被界面接住：一张写着 `connected` 的卡下面摆着一排空框，
// **「已存但隐藏」和「什么都没配」长得一模一样**（UX-65）。
// owner 因此没法判断"我到底要不要重填"，而重填一次就把好凭据覆盖掉了。
//
// 保密不变，只是把**已知的事实**说出来：值不回来，但"有"这件事后端一直在说。
function StoredCredsNote({ show }: { show: boolean }) {
  const t = useTranslations('adminShell.connectorCard');
  return show ? (
    <p
      data-testid="connector-creds-stored"
      className="mono text-[11px] text-(--color-muted) reading-tight"
    >
      {t('credsStored')}
    </p>
  ) : null;
}

// isSecret —— 凭据里该遮的字段（密钥/口令/token）。
function isSecret(key: string): boolean {
  return /secret|token|password|key/i.test(key);
}

// RedirectUri —— oauth2 才有：owner 拿去 SaaS 注册 OAuth client 的回调地址（只读）。
function RedirectUri({ id, authType }: { id: string; authType: string }) {
  return authType === 'oauth2' ? (
    <input
      data-testid="connector-redirect-uri"
      readOnly
      value={`/api/admin/connectors/${id}/callback`}
      className="w-full mb-3 bg-(--color-surface)/40 border border-(--color-rule) rounded-sm p-2 mono text-[11px] text-(--color-muted)"
    />
  ) : null;
}

function Scopes({ hook }: { hook: ConnectorCardHook }) {
  return hook.scopes.length === 0 ? null : (
    <div className="space-y-1 mb-3">
      {hook.scopes.map((scope) => (
        <label key={scope} className="flex items-center gap-2 mono text-[11px] text-(--color-muted)">
          <input
            type="checkbox"
            data-testid={`connector-scope-${scope}`}
            onChange={(e) => hook.setScope(scope, e.target.checked)}
          />
          {scope}
        </label>
      ))}
    </div>
  );
}

function Actions({ hook }: { hook: ConnectorCardHook }) {
  const t = useTranslations('adminIntegrations.common');
  return (
    <div className="flex gap-2">
      <button
        type="button" onClick={hook.connect}
        data-testid="connector-connect-button"
        className="sm-btn sm-btn-solid sm-btn-sm"
      >
        {t('connect')}
      </button>
      <DisconnectButton hook={hook} />
    </div>
  );
}

function DisconnectButton({ hook }: { hook: ConnectorCardHook }) {
  const t = useTranslations('adminIntegrations.connectorCard');
  return hook.connected ? (
    <button
      type="button" onClick={hook.disconnect}
      data-testid="connector-disconnect-button"
      className="sm-btn sm-btn-ghost sm-btn-sm"
    >
      {t('disconnect')}
    </button>
  ) : null;
}

function ErrorLine({ error }: { error: string }) {
  return error === '' ? null : (
    <p data-testid="connector-error" className="mt-2 mono text-[11px] text-(--color-accent)">
      {error}
    </p>
  );
}
