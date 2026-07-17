// AssembleView —— 归一装配视图（一个品类一套）。owner 二选一：贴 OpenAPI { spec, binding } 上传一个
// per-SaaS 连接器（openapi 路，提交后用 ConnectorCard 派生表单 + scheme + connect），或填内置协议
// （CalDAV/SMTP）的固定表单直接连（protocol 路）。归一鈦：两 kind 同一个视图，连上后跑同一品类契约。

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { useSpecAssemble } from '@/lib/admin/use-assemble';
import { useProtocolConnect, type ProtocolConnectHook } from '@/lib/admin/use-protocol-connect';
import {
  protocolForCategory, seedDefaults, fieldDefault, type AssembleField,
} from '@/lib/admin/assemble-fields';
import { ConnectorCard } from '@/components/admin/sections/connectors/ConnectorCard';

export function AssembleView({ category }: { category: string }) {
  const [openapiID, setOpenapiID] = useState<string | null>(null);
  const spec = useSpecAssemble(setOpenapiID);
  return (
    <div className="sm-connector-modal-body space-y-5">
      <SpecUpload spec={spec} />
      <AssembleBody category={category} openapiID={openapiID} />
    </div>
  );
}

// AssembleBody —— 上传过 spec → 渲染那个 openapi 连接器的卡（派生表单 + connect）；否则渲染内置协议
// 固定表单。两路都以 connector-field-{k} + connector-connect-button + connector-status 收口。
function AssembleBody({ category, openapiID }: { category: string; openapiID: string | null }) {
  return openapiID === null
    ? <ProtocolForm category={category} />
    : <ConnectorCard entry={{ id: openapiID, category, kind: 'openapi' }} />;
}

function SpecUpload({ spec }: { spec: ReturnType<typeof useSpecAssemble> }) {
  const t = useTranslations('adminIntegrations.assemble');
  return (
    <div className="border-b border-(--color-rule)/60 pb-5">
      <p className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) mb-2">
        {t('uploadLabel')}
      </p>
      <textarea
        data-testid="connector-spec-input"
        onChange={(e) => spec.setSpec(e.target.value)}
        placeholder='{ "spec": { … }, "binding": { … } }'
        rows={5}
        className="w-full bg-transparent border border-(--color-rule) focus:border-(--color-ink) rounded-sm p-2 mono text-[12px]"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button" onClick={spec.submit}
          data-testid="connector-spec-submit"
          className="sm-btn sm-btn-solid sm-btn-sm"
        >
          {t('uploadSubmit')}
        </button>
        <SpecError error={spec.error} />
      </div>
    </div>
  );
}

function SpecError({ error }: { error: string }) {
  return error === '' ? null : (
    <span className="mono text-[11px] text-(--color-accent)">{error}</span>
  );
}

// ProtocolForm —— 内置协议（CalDAV/SMTP）的固定凭据表单 + connect（use-protocol-connect 建连接器 +
// 存凭据 + 连接测试）。
function ProtocolForm({ category }: { category: string }) {
  const proto = protocolForCategory(category);
  return proto === undefined ? null : <ProtocolFields category={category} proto={proto} />;
}

function ProtocolFields(
  { category, proto }: { category: string; proto: NonNullable<ReturnType<typeof protocolForCategory>> },
) {
  const hook = useProtocolConnect(proto.protocol, category);
  const [values] = useState<Record<string, string>>(() => seedDefaults(proto.fields));
  return (
    <div className="space-y-2">
      {proto.fields.map((f) => (
        <TextField key={f.k} field={f} onChange={(v) => { values[f.k] = v; }} />
      ))}
      <ConnectRow hook={hook} onConnect={() => { hook.saveAndConnect(values); }} />
    </div>
  );
}

function TextField({ field, onChange }: { field: AssembleField; onChange: (v: string) => void }) {
  return (
    <input
      data-testid={`connector-field-${field.k}`}
      type={field.secret ? 'password' : 'text'}
      placeholder={field.label}
      defaultValue={fieldDefault(field)}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-transparent border border-(--color-rule) focus:border-(--color-ink) rounded-sm p-2 mono text-[12px]"
    />
  );
}

// ConnectRow —— 协议路的 Connect 按钮 + 状态/错误。save() 建连接器+存凭据，随后真连接测试。
function ConnectRow({ hook, onConnect }: { hook: ProtocolConnectHook; onConnect: () => void }) {
  const t = useTranslations('adminIntegrations.common');
  return (
    <div className="pt-2 space-y-2">
      <button
        type="button"
        data-testid="connector-connect-button"
        onClick={() => { onConnect(); hook.connect(); }}
        className="sm-btn sm-btn-solid sm-btn-sm"
      >
        {t('connect')}
      </button>
      <p data-testid="connector-status" className="mono text-[11px] text-(--color-muted)">
        {protoStatusText(hook.status)}
      </p>
      <ProtoError error={hook.error} />
    </div>
  );
}

// protoStatusText —— connecting… 不含 "connected" 子串，让 expectConnected 真等到 connect 落定。
function protoStatusText(status: string): string {
  return status === 'connected' ? 'connected' : status === 'connecting' ? 'connecting…' : 'not connected';
}

function ProtoError({ error }: { error: string }) {
  return error === '' ? null : (
    <p data-testid="connector-error" className="mono text-[11px] text-(--color-accent)">{error}</p>
  );
}
