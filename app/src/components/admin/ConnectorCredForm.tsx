// ConnectorCredForm —— #155 区 B：从派生的 auth forms 渲通用凭据表单。owner 贴 spec → 后端按
// securitySchemes 派生 → 这里据 AuthType 渲对应字段（oauth2: client_id/secret/scope/redirect_uri +
// Connect；apikey: key + 落点提示；basic: user/pass；bearer: token）。多方案给选择器。无/不支持
// 认证 → connector-status 提示。不每个连接器手写表单。

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { SelectField } from '@/components/atoms/SelectField';
import type { AuthField, AuthForms, AuthScheme } from '@/lib/admin/use-connector-ingest';

// onScheme / values —— 装配那一步要的两样东西。scheme 是**建**连接器的参数（写进 manifest），
// values 是**建完之后**存进那个连接器的凭据。没有它们时这张表单填了也没地方去
// （同 [[write-with-no-receipt]]：token 那一格看着能填，其实是个死胡同）。
//
// values 用「调用方给一个对象、这里往里写」的写法，跟 AssembleView 的协议表单同一个套路，
// 免得为几个非受控输入再拉一层 state。
export function ConnectorCredForm({ auth, onScheme, values, scopes }: {
  auth: AuthForms;
  onScheme?: (s: string) => void;
  values?: Record<string, string>;
  scopes?: Set<string>;
}) {
  return (
    <div data-testid="connector-cred-form" className="mt-4 border-t border-(--color-rule)/60 pt-4">
      <CredNote note={auth.note ?? ''} />
      <SchemePicker forms={auth.forms ?? []} onScheme={onScheme} values={values} scopes={scopes} />
    </div>
  );
}

function CredNote({ note }: { note: string }) {
  return note === ''
    ? null
    : <p data-testid="connector-status" className="mono text-[12px] text-(--color-accent)">{note}</p>;
}

function SchemePicker({ forms, onScheme, values, scopes }: {
  forms: AuthScheme[];
  onScheme?: (s: string) => void;
  values?: Record<string, string>;
  scopes?: Set<string>;
}) {
  const [scheme, setScheme] = useState('');
  const selected = forms.find((f) => f.scheme === scheme) ?? forms[0];
  const pick = (s: string) => { setScheme(s); onScheme?.(s); };
  return selected === undefined
    ? null
    : (
      <SchemePickerBody
        forms={forms} selected={selected} onScheme={pick} values={values} scopes={scopes}
      />
    );
}

function SchemePickerBody({
  forms, selected, onScheme, values, scopes,
}: {
  forms: AuthScheme[];
  selected: AuthScheme;
  onScheme: (s: string) => void;
  values?: Record<string, string>;
  scopes?: Set<string>;
}) {
  return (
    <>
      <SchemeSelectMaybe forms={forms} value={selected.scheme} onChange={onScheme} />
      <SchemeBody form={selected} values={values} scopes={scopes} />
    </>
  );
}

function SchemeSelectMaybe({
  forms, value, onChange,
}: { forms: AuthScheme[]; value: string; onChange: (s: string) => void }) {
  const t = useTranslations('adminShell.connectorCred');
  return forms.length <= 1 ? null : (
    <label className="block mb-3">
      <span className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) block mb-1">
        {t('authentication')}
      </span>
      <SelectField
        testid="connector-scheme-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        mono
      >
        {forms.map((f) => <option key={f.scheme} value={f.scheme}>{f.scheme}</option>)}
      </SelectField>
    </label>
  );
}

function SchemeBody({ form, values, scopes }: {
  form: AuthScheme;
  values?: Record<string, string>;
  scopes?: Set<string>;
}) {
  return (
    <div className="space-y-3">
      {form.fields.map((f) => <CredField key={f.key} field={f} values={values} scopes={scopes} />)}
      <ApiKeyHint form={form} />
      <DiscoveryHint form={form} />
      <ConnectMaybe form={form} />
    </div>
  );
}

const codeTag = (chunks: ReactNode) => <code className="mono">{chunks}</code>;

function ApiKeyHint({ form }: { form: AuthScheme }) {
  return form.type === 'apikey' ? <ApiKeyHintBody form={form} /> : null;
}

function ApiKeyHintBody({ form }: { form: AuthScheme }) {
  const t = useTranslations('adminShell.connectorCred');
  return (
    <p className="reading-tight text-[12px] text-(--color-muted)">
      {t.rich('apiKeyHint', { where: form.in ?? '', name: form.param_name ?? '', code: codeTag })}
    </p>
  );
}

function DiscoveryHint({ form }: { form: AuthScheme }) {
  const url = form.discovery_url ?? '';
  return url === '' ? null : <DiscoveryHintBody url={url} />;
}

function DiscoveryHintBody({ url }: { url: string }) {
  const t = useTranslations('adminShell.connectorCred');
  return (
    <p className="reading-tight text-[12px] text-(--color-muted)">
      {t.rich('discoveryHint', { url, code: codeTag })}
    </p>
  );
}

// NeedsDanceNote —— 「这个方案要走一次授权跳转」是**真实的信号**，owner 该在填凭据时就知道。
//
// 但这里以前渲染的是一个 `connector-connect-button` **按钮，而且没有 onClick**（F-C-24）。
// 后果不是"少一个功能"：装配这条路上，owner（和 e2e）点下去什么都不会发生，
// 而屏幕上找不出任何"没生效"的迹象 —— 直到 15 秒后轮询超时才知道连接从未发起。
// 连接是**卡片**的职责（卡片才有连接器 id），摄入表单从来就没有能力连。
// 而且两处同名 testid 一旦同时在场，定位器还会撞车。
//
// 所以信号留下，元件换掉：说一句话，别摆一个按不动的按钮。
function ConnectMaybe({ form }: { form: AuthScheme }) {
  return form.needs_dance ? <NeedsDanceNote /> : null;
}

function NeedsDanceNote() {
  const t = useTranslations('adminShell.connectorCred');
  return (
    <p
      data-testid="connector-needs-dance"
      className="reading-tight text-[12px] text-(--color-muted)"
    >
      {t('needsDance')}
    </p>
  );
}

function CredField({ field, values, scopes }: {
  field: AuthField;
  values?: Record<string, string>;
  scopes?: Set<string>;
}) {
  return field.type === 'scopes'
    ? <ScopeField field={field} scopes={scopes} />
    : <PlainField field={field} values={values} />;
}

// ScopeField —— oauth2 的 scope 多选。勾选结果写进 scopes（跟 values 同一个套路：调用方给个
// 容器，这里往里写）。**没有它的话这些复选框勾了以后无处可去** —— 装配送出的凭据不带 scope，
// 授权跳转就少了范围，而界面上一切正常。
// toggleScope —— 勾上加、取消删。抽出来只为把分支摊开（内联的三元 + 两个可选链超 complexity 闸）。
function toggleScope(scopes: Set<string>, s: string, on: boolean): void {
  on ? scopes.add(s) : scopes.delete(s);
}

function ScopeField(
  { field, scopes = new Set<string>() }: { field: AuthField; scopes?: Set<string> },
) {
  const t = useTranslations('adminShell.connectorCred');
  const all = field.scopes ?? [];
  // 默认全勾 → 容器的初值也得是全勾，否则「一次都没点过」等于一个都没选。
  all.forEach((s) => scopes.add(s));
  return (
    <div>
      <span className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) block mb-1">
        {t('scopes')}
      </span>
      <div data-testid={`connector-field-${field.key}`} className="flex flex-wrap gap-1.5">
        {all.map((s) => (
          <label key={s} className="mono text-[11px] flex items-center gap-1">
            <input
              type="checkbox" defaultChecked data-testid={`connector-scope-${s}`}
              onChange={(e) => { toggleScope(scopes, s, e.target.checked); }}
            />
            {s}
          </label>
        ))}
      </div>
    </div>
  );
}

function PlainField({ field, values }: { field: AuthField; values?: Record<string, string> }) {
  const readonly = field.type === 'readonly';
  return (
    <label className="block">
      <span className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) block mb-1">
        {field.key}
      </span>
      <input
        type={field.type === 'password' ? 'password' : 'text'}
        data-testid={`connector-field-${field.key}`}
        readOnly={readonly}
        defaultValue={readonly ? '/api/admin/connectors/{id}/callback' : ''}
        onChange={(e) => { values && (values[field.key] = e.target.value); }}
        className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-1.5 mono text-[12px]"
      />
    </label>
  );
}
