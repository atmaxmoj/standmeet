// ConnectorCard —— 一张连接器卡（内置或上传）：派生凭据表单（connector-field-{key}）+ oauth2 的
// redirect-uri（只读）/ scope 多选 + Connect/Disconnect + 状态/错误。归一鈦：任何 kind/auth 一套
// 卡。逻辑在 use-connector-card；这里只渲染 + 连线（eslint：无 if、复杂度 ≤3）。

'use client';

import { useTranslations } from 'next-intl';

import { ConnectorOps } from '@/components/admin/sections/connectors/ConnectorOps';
import { SelectField } from '@/components/atoms/SelectField';
import { useConnectorRedirectURI } from '@/lib/admin/redirect-uri';
import { useConnectorCard, type ConnectorCardHook } from '@/lib/admin/use-connector-card';
import type { CatalogEntry } from '@/lib/admin/use-connector-catalog';
import { credFieldLabel } from '@/lib/admin/cred-field-label';

export function ConnectorCard({ entry }: { entry: CatalogEntry }) {
  return (
    <li
      data-testid={`connector-row-${entry.id}`}
      className="crosshair border border-(--color-rule) rounded-sm bg-(--color-surface)/30 p-4"
    >
      <span className="ch-tl" /><span className="ch-br" />
      <ConnectorCardBody entry={entry} />
    </li>
  );
}

// ConnectorCardBody —— 一张卡的主体：状态 + 派生凭据表单 + Connect/Disconnect。
//
// **内置的和 owner 自己传进来的共用这一份**（F-C-47）。传进来的那一族原先只渲染
// 「品类 / 来源 / kind / 状态 / 删除」—— 于是产品让 owner 建一个**它不给任何办法去连**
// 的连接器，而那一节的导语正写着 "upload your own (OpenAPI / protocol) connector"。
// 缺的从来不是能力：`/{id}/credential-form`、`/{id}/credentials`、`/{id}/connect`
// 对任何 id 都在，表单也本来就是**后端按连接器自己的声明派生**的 —— 所以这里没有为
// caldav 或任何一种 kind 写第二套 UI，只是把同一个主体接到了另一族行上。
export function ConnectorCardBody({ entry }: { entry: CatalogEntry }) {
  const hook = useConnectorCard(entry.id);
  return (
    <>
      <CardHead category={entry.category} connected={hook.connected} connecting={hook.connecting} />
      <ScopeShortfallNote missing={hook.missingScopes} />
      <UnreadableNote reason={hook.unreadable} />
      <SchemeSelect schemes={hook.schemes} />
      <Fields hook={hook} />
      <RedirectUri id={entry.id} authType={hook.authType} />
      <Scopes hook={hook} />
      <Actions hook={hook} />
      <ErrorLine error={hook.error} />
      <ConnectorOps ops={entry.owner_ops ?? []} onRan={hook.reloadStatus} />
    </>
  );
}

function CardHead(
  { category, connected, connecting }: { category: string; connected: boolean; connecting: boolean },
) {
  return (
    <div className="flex items-center justify-between mb-3">
      {/* 卡名要比卡里的字段重。以前是 `text-sm`，跟右边的 `not connected`、下面的
          `bearer` / `TOKEN` 几乎平起平坐 —— 而这张卡是一个**可操作的对象**，字段是它的
          内容。同一段里 GOOGLE CALENDAR 那张已经是这个层级，三张品类卡当时没跟上。 */}
      <span className="font-serif text-[17px] tracking-[-0.01em] text-(--color-ink)">
        {category}
      </span>
      <span data-testid="connector-status" className="mono text-[11px] text-(--color-muted)">
        {statusText(connected, connecting)}
      </span>
    </div>
  );
}

// UnreadableNote —— 这台实例读不懂这份凭据了（F-C-41）。
//
// prod 上真轮换过一次 `INSTANCE_SECRET`：后端正常起来，而这一页把**每一张卡**都渲成
// `not connected` + 一排空框，屏幕上一个字都没有 —— 一句关于世界的假话（库里密文和
// `connected_at` 都还在），而且它指向一个动作（重填凭据），于是 owner 会在一份自己
// 没读到的配置上面动手。
//
// 这句话就摆在卡名下面，因为出问题的是**这张卡**（跟 F-C-23 把拒绝贴在出错的框下面同一条规矩）。
// 措辞不提密钥、不提密文：owner 要做的只是重新连一次。
// ScopeShortfallNote —— 紧贴在 `connected` 下面那一行：**这个授权做不了什么**（F-B-8）。
//
// 为什么排在这儿：`connected` 说的是「我们手里有一个 token」，而 owner 读它的时候以为
// 说的是「这个连接能干它被要求干的事」。只授了 `calendar.readonly` 时那两件事分叉 ——
// 读是通的、列时段是好的，只有写永远做不了，而访客那一侧因此少了订会（F-B-8 已按工具摘掉）。
// owner 唯一能看见这件事的地方就是这张卡，所以这句话必须挨着那个词。
//
// 说**缺哪个 scope**，不说「有些动作不可用」：owner 的下一步是把它勾上再连一次，
// 而没有名字的话他无从下手。
function ScopeShortfallNote({ missing }: { missing: readonly string[] }) {
  const t = useTranslations('adminShell.connectorCard');
  return missing.length === 0 ? null : (
    <p
      data-testid="connector-scope-shortfall"
      className="mb-3 mono text-[11px] text-(--color-accent) reading-tight"
    >
      {t('scopeShortfall', { scopes: missing.join(', ') })}
    </p>
  );
}

function UnreadableNote({ reason }: { reason: string }) {
  return reason === '' ? null : (
    <p
      data-testid="connector-unreadable"
      className="mb-3 mono text-[11px] text-(--color-accent) reading-tight"
    >
      {reason}
    </p>
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
    // space-y-4 而不是 space-y-2：加了标签之后，一格的高度变成「标签 + 6px 内距 + 文字 + 下划线」，
    // 于是每个标签离**上一格的线**比离**自己的线**还近，眼睛把它归到上面那格去了。
    // 字段之间要比字段内部松 —— 这是分组，不是留白偏好。
    <div className="space-y-4 mb-3">
      <StoredCredsNote show={hook.hasCredentials} />
      {hook.fields.map((key) => <CredField key={key} name={key} onChange={hook.setField} />)}
    </div>
  );
}

// CredField —— 一格凭据，**带一个留得住的标签**。
//
// 这几格原来只有 placeholder：`host` / `port` / `username` / `password` / `from_address` /
// `from_name` / `tls` 七个一模一样的框，而 placeholder 在你一开始打字的瞬间就消失 ——
// 填到第四格就说不清哪格是哪格了（UX-58 的一半）。字段名一直在手里，只是没渲染成标签。
//
// **这一条只做得了这一半**：UX-58 还说了「没有分组（连接参数 vs 发信身份）」和
// 「`tls` 那一格从表单上根本答不出来（布尔？starttls？端口？）」—— 那两条要连接器**声明**
// 分组和字段说明（`CredentialForm` 现在只有 `Fields []string`），是新数据，归 Result 列。
//
// 文本输入在这个产品里只有一种长相：下划线（`.sm-field-input`）。凭据这几格曾是**整框**，
// 于是同一种控件隔一屏就是两个标准（UX-59）。
function CredField({ name, onChange }: {
  name: string; onChange: (k: string, v: string) => void;
}) {
  return (
    <label className="sm-field">
      <span className="sm-field-label">{credFieldLabel(name)}</span>
      <input
        data-testid={`connector-field-${name}`}
        type={isSecret(name) ? 'password' : 'text'}
        onChange={(e) => onChange(name, e.target.value)}
        className="sm-field-input sm-mono"
      />
    </label>
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
// **必须是绝对地址**：provider 的控制台只收完整 URI（F-C-32）。origin 取自 owner 此刻
// 访问这一页用的那个地址 —— 见 lib/admin/redirect-uri.ts。
function RedirectUri({ id, authType }: { id: string; authType: string }) {
  const uri = useConnectorRedirectURI(id);
  return authType === 'oauth2' ? (
    <input
      data-testid="connector-redirect-uri"
      readOnly
      value={uri}
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
            // 已授的要勾上（F-C-33）。以前这里既没有 checked 也没有 defaultChecked ——
            // 于是这排框只能往里写、读不出来，一条连着的连接看起来像什么权限都没有。
            // 用 defaultChecked + key 而不是受控：勾选状态归浏览器管（setScope 已经在存），
            // 而 key 带上 granted，表单**重新拉到**已授范围时这一排会按新值重建。
            key={`${scope}:${hook.granted.includes(scope)}`}
            defaultChecked={hook.granted.includes(scope)}
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
