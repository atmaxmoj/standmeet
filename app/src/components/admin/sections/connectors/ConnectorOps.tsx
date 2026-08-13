// ConnectorOps —— 一张卡上,这个连接器**自己声明**的那些 owner 操作(后端 connector/owner_op.go)。
//
// 为什么是通用的一块,而不是 mail 卡上一个写死的「发测试信」按钮:声明本来就是数据 ——
// smtp 的 manifest 里写了 connectors.mail_test_send,目录就把它带上来,这里照着渲。加一个
// 动作 = 在那个连接器的 manifest 里加一段,这个文件一行不改。反过来写死的话,通用的这一层
// 里就会出现 "mail" 这个词,而那正是后端把 owner-op 从注册表上拆下来的理由。
//
// F-C-12:这块面以前不存在。操作、路由、失败归类在后端全是通的,五条 e2e 也都在跑它 ——
// 但全走 HTTP/MCP。owner 存完凭据点了 Connect,看到 `connected`,然后没有任何办法知道信到底
// 发不发得出去,第一封真信就是发给陌生人的那一封。

'use client';

import { useTranslations } from 'next-intl';

import type { OwnerOp, OwnerOpField } from '@/lib/admin/use-connector-catalog';
import { useConnectorOp, type ConnectorOpHook } from '@/lib/admin/use-connector-op';

export function ConnectorOps({ ops }: { ops: readonly OwnerOp[] }) {
  return ops.length === 0 ? null : (
    <div className="mt-3 border-t border-(--color-rule)/60 pt-3 space-y-3">
      {ops.map((op) => <ConnectorOpBlock key={op.name} op={op} />)}
    </div>
  );
}

function ConnectorOpBlock({ op }: { op: OwnerOp }) {
  const hook = useConnectorOp(op);
  return (
    <div data-testid={`connector-op-${hook.segment}`} className="space-y-2">
      <p className="reading-tight text-[12px] text-(--color-muted)">{op.description}</p>
      <OpFields fields={op.fields ?? []} hook={hook} />
      <RunButton hook={hook} />
      <OpResult hook={hook} />
    </div>
  );
}

function OpFields({ fields, hook }: { fields: readonly OwnerOpField[]; hook: ConnectorOpHook }) {
  return (
    <div className="space-y-2">
      {fields.map((f) => (
        <input
          key={f.key}
          data-testid={`connector-op-field-${f.key}`}
          type={inputType(f.type)}
          placeholder={f.key}
          aria-label={f.description ?? f.key}
          onChange={(e) => hook.setField(f.key, e.target.value, f.type ?? 'string')}
          className="sm-field-input sm-mono"
        />
      ))}
    </div>
  );
}

// inputType —— 声明说这格是数字,就给一个数字控件。声明里能出现的标量只有这三种
// (派生不出来的字段在装载时就被拒了),所以这里不需要兜底一个「万一呢」的分支。
function inputType(declared: string | null | undefined): 'text' | 'number' {
  return declared === 'integer' || declared === 'number' ? 'number' : 'text';
}

function RunButton({ hook }: { hook: ConnectorOpHook }) {
  const t = useTranslations('adminIntegrations.connectorOp');
  return (
    <button
      type="button" onClick={hook.run} disabled={hook.running}
      data-testid="connector-op-run"
      className="sm-btn sm-btn-ghost sm-btn-sm"
    >
      {hook.running ? t('running') : t('run')}
    </button>
  );
}

// OpResult —— 跑完之后那一句。三种情况分开说,因为对 owner 是三件不同的事:
// 请求没走通(他的浏览器到实例这一段)/ 操作跑了但没成(后端归好类的原话)/ 成了(哪一路送的)。
function OpResult({ hook }: { hook: ConnectorOpHook }) {
  return hook.outcome === null ? null : (
    <p data-testid="connector-op-result" className="mono text-[11px] text-(--color-accent)">
      <OpResultText outcome={hook.outcome} />
    </p>
  );
}

function OpResultText({ outcome }: { outcome: NonNullable<ConnectorOpHook['outcome']> }) {
  const t = useTranslations('adminIntegrations.connectorOp');
  return <>{resultSentence(outcome, t)}</>;
}

type Translate = ReturnType<typeof useTranslations<'adminIntegrations.connectorOp'>>;

function resultSentence(
  outcome: NonNullable<ConnectorOpHook['outcome']>, t: Translate,
): string {
  return outcome.reached ? reachedSentence(outcome, t) : t('unreachable');
}

function reachedSentence(
  outcome: NonNullable<ConnectorOpHook['outcome']>, t: Translate,
): string {
  return outcome.ok ? successSentence(outcome, t) : failureSentence(outcome.reason, t);
}

// successSentence —— 操作自己说了一句就用它的。
//
// 老那句(`sent`)是**邮件口吻**的:「被 {kind} 连接器收下了 —— 去收件箱确认它到了」。
// 它长在这个通用组件里,于是任何第二个品类的成功都会读成胡话 —— 日历自检没有收件箱。
// 失败那句早就由操作自己给了(后端归好类),成功这句本该同样如此。
function successSentence(
  outcome: NonNullable<ConnectorOpHook['outcome']>, t: Translate,
): string {
  return outcome.summary === '' ? t('sent', { kind: outcome.viaKind }) : outcome.summary;
}

// failureSentence —— 失败那句**原样用后端的**:它在后端已经归过类了(改配置 / 换收件人 /
// 等一会儿再试),这一层再包一次只会把它冲淡。后端没给理由时不编一句糊上去 —— 说清楚它没给,
// 因为「它没给理由」本身就是排查时要知道的那件事。
function failureSentence(reason: string, t: Translate): string {
  return reason === '' ? t('failedNoReason') : reason;
}
