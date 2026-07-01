// CapabilitiesPanel —— Phase H 管理面「能力」卡。列全部 capability + connector +
// skill，每行：名字 + origin 徽章（builtin/managed/owner）+ owner-enable 开关
// （builtin 可关不可删，P.7）+ connector 依赖状态 + 仅 owner-origin 的删除入口
// （P.6）。沿用 connector 卡的视觉语言（crosshair + mono kicker）。

'use client';

import { useEffect } from 'react';

import {
  useCapabilities, dependencyHint,
  type CapabilityRow, type CapabilitiesHook,
} from '@/lib/admin/use-capabilities';
import { useAction } from '@/lib/ui/use-action';
import { useReportError } from '@/lib/ui/use-report-error';

export function CapabilitiesPanel() {
  const hook = useCapabilities();
  const { ensureLoaded } = hook;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return (
    <section
      className="crosshair border border-(--color-rule) rounded-sm bg-(--color-surface)/30 p-5"
      data-testid="capabilities-panel"
    >
      <span className="ch-tl" /><span className="ch-br" />
      <Header />
      <Body hook={hook} />
    </section>
  );
}

function Header() {
  return (
    <div className="mb-4">
      <p className="mono text-[10px] tracking-[0.12em] uppercase text-(--color-muted)">
        availability
      </p>
      <h3 className="mt-1 text-lg text-(--color-ink)">capabilities</h3>
      <p className="mt-1 text-sm text-(--color-muted)">
        Turn a capability off and its tools vanish from every visitor session.
        Built-in capabilities can be disabled but not deleted; only the ones you
        authored can be removed.
      </p>
    </div>
  );
}

function Body({ hook }: { hook: CapabilitiesHook }) {
  return hook.status === 'idle' || hook.status === 'loading'
    ? <Msg text="loading…" />
    : <Loaded hook={hook} />;
}

function Loaded({ hook }: { hook: CapabilitiesHook }) {
  return hook.status === 'error'
    ? <Msg text="couldn’t load capabilities." accent />
    : hook.rows.length === 0
      ? <Msg text="no capabilities registered." />
      : <CapList hook={hook} />;
}

function Msg({ text, accent = false }: { text: string; accent?: boolean }) {
  return (
    <p className={`mono text-xs ${accent ? 'text-(--color-accent)' : 'text-(--color-muted)'}`}>
      {text}
    </p>
  );
}

// available —— 本面板是「availability」平面：依赖某 connector 的能力，只在依赖连上时才显示（连上
// 才真能用；删 provider / 没连 → 复闸隐藏）。无依赖的能力恒显。API 仍列全（带 dependency 状态）。
function available(row: CapabilityRow): boolean {
  return !row.dependency || row.dependency.connected;
}

function CapList({ hook }: { hook: CapabilitiesHook }) {
  return (
    <ul className="divide-y divide-(--color-rule)/60">
      {hook.rows.filter(available).map((row) => (
        <CapabilityItem key={row.id} row={row} hook={hook} />
      ))}
    </ul>
  );
}

function CapabilityItem({ row, hook }: { row: CapabilityRow; hook: CapabilitiesHook }) {
  const hint = dependencyHint(row);
  return (
    <li className="flex items-center gap-3 py-3" data-testid={`capability-row-${row.id}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm text-(--color-ink)">{row.id}</span>
          <OriginBadge row={row} />
          <KindBadge row={row} />
        </div>
        {hint && <p className="mt-0.5 mono text-[10px] text-(--color-accent)">{hint}</p>}
      </div>
      <EnableToggle row={row} hook={hook} />
      <DeleteBtn row={row} hook={hook} />
    </li>
  );
}

const BADGE_BASE =
  'inline-flex items-center px-1.5 py-0.5 border rounded-sm mono ' +
  'text-[10px] tracking-[0.04em] lowercase leading-[1.3]';

function OriginBadge({ row }: { row: CapabilityRow }) {
  const tone =
    row.origin === 'owner'
      ? 'text-(--color-accent) border-(--color-accent)/50'
      : 'text-(--color-muted) border-(--color-rule)';
  return <span className={`${BADGE_BASE} ${tone}`} data-testid={`origin-${row.id}`}>{row.origin}</span>;
}

function KindBadge({ row }: { row: CapabilityRow }) {
  return row.kind === 'capability'
    ? null
    : <span className={`${BADGE_BASE} text-(--color-muted) border-(--color-rule)`}>{row.kind}</span>;
}

// connector 行的 enabled 反映连接状态、不可手动切（连/断在各自 connector 卡做）。
function toggleTrackClass(enabled: boolean, locked: boolean): string {
  const tint = enabled
    ? 'bg-(--color-ink) border-(--color-ink)'
    : 'bg-transparent border-(--color-rule)';
  const cursor = locked ? ' opacity-40 cursor-not-allowed' : ' cursor-pointer';
  return `relative h-5 w-9 shrink-0 rounded-full border transition-colors ${tint}${cursor}`;
}

function toggleKnobClass(enabled: boolean): string {
  const pos = enabled ? 'left-[18px] bg-(--color-paper)' : 'left-0.5 bg-(--color-muted)';
  return `absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${pos}`;
}

function EnableToggle({ row, hook }: { row: CapabilityRow; hook: CapabilitiesHook }) {
  const report = useReportError();
  const locked = row.kind === 'connector';
  // 悲观开关：store 控制（无乐观 mutate），只有服务端确认后才动。失败别静默（原来 void 吞掉 →
  // 关掉的能力可能还活着，安全隐患）；不加成功 toast——开关动了本身就是反馈。
  return (
    <button
      type="button"
      role="switch"
      aria-checked={row.enabled}
      disabled={locked}
      data-testid={`toggle-${row.id}`}
      onClick={() => { void hook.setEnabled(row.id, !row.enabled).catch(report); }}
      className={toggleTrackClass(row.enabled, locked)}
    >
      <span className={toggleKnobClass(row.enabled)} />
    </button>
  );
}

function DeleteBtn({ row, hook }: { row: CapabilityRow; hook: CapabilitiesHook }) {
  const run = useAction();
  return row.deletable
    ? (
      <button
        type="button"
        data-testid={`delete-${row.id}`}
        title="remove capability"
        onClick={() => { void run(() => hook.remove(row.id), { success: 'Capability removed' }); }}
        className="w-6 shrink-0 text-(--color-muted) hover:text-(--color-accent) transition-colors"
      >
        ✕
      </button>
    )
    : <span className="w-6 shrink-0" aria-hidden />;
}
