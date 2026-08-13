// AssembleView —— 归一装配视图（一个品类一套）。owner 二选一：上传一份 OpenAPI spec 装配一个
// per-SaaS 连接器（openapi 路），或填内置协议（CalDAV/SMTP）的固定表单直接连（protocol 路）。
// 归一鈦：两 kind 同一个视图，连上后跑同一品类契约。
//
// **openapi 那一半渲染的是 ConnectorSpecIngest 本尊，不是这里自己搓的第二个表单**（F-C-21）。
// 原来这里有一个只收 `{ spec, binding }` 整块 JSON 的文本框 —— 跟目录层那个表单的 payload 形状
// 不是一个东西，而且从目录层走过来时会把已填的候选/方案/token 全部清空。两份实现就是漂移本身。
//
// 品类卡这个入口留着是有理由的：owner 点进 Calendar 只看得见 CalDAV 的话，不会知道还能自带一份
// OpenAPI 日历。但**品类对 openapi 这条路不起作用** —— 品类由 binding 声明（后端 BindingCategory），
// 跟点了哪张卡无关。

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { useProtocolConnect, type ProtocolConnectHook } from '@/lib/admin/use-protocol-connect';
import {
  protocolForCategory, seedDefaults, fieldDefault, type AssembleField,
} from '@/lib/admin/assemble-fields';
import { ConnectorSpecIngest } from '@/components/admin/ConnectorSpecIngest';
import type { AssembleInput, AssembleState } from '@/lib/admin/use-connector-upload';

export function AssembleView({ category, onAssemble, assemble }: {
  category: string;
  onAssemble?: (input: AssembleInput) => void;
  assemble?: AssembleState;
}) {
  const [specChosen, setSpecChosen] = useState(false);
  return (
    <div className="sm-connector-modal-body space-y-5">
      <ConnectorSpecIngest
        onAssemble={onAssemble} onCandidate={setSpecChosen} assemble={assemble}
      />
      <ProtocolFormMaybe category={category} hidden={specChosen} />
    </div>
  );
}

// ProtocolFormMaybe —— spec 校验出候选之后就把协议表单收起来。两个理由，一个产品一个机制：
//
// 产品 —— owner 已经选定了「自带一份 OpenAPI」这条路，屏幕上再摆一套 CalDAV 凭据框，就是
// item 的 LOOK 行说的那种「两个做同一件事、做法却不同的表单」。
//
// 机制 —— 两套表单的字段 testid 同名空间（connector-field-{key}）。今天恰好不撞是因为
// oauth2 派生出 client_id/client_secret 而 CalDAV 是 url/username/password；一份声明 basic
// 认证的 spec 会派生出 username/password，当场撞车。**靠字段名恰好不重来保证唯一性**不是保证。
function ProtocolFormMaybe({ category, hidden }: { category: string; hidden: boolean }) {
  return hidden ? null : <ProtocolForm category={category} />;
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
      className="sm-field-input sm-mono"
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
