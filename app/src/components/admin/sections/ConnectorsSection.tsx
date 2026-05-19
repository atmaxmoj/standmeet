// ConnectorsSection —— /admin/connectors。tiles 只是设计稿占位，所有 connector
// 实际上没有 backend 接通；toggle 只更新 local state + 显示"coming soon"。

'use client';

import { SectionHeader } from '../SectionHeader';
import { ConnectorTile } from './connectors/ConnectorTile';
import { useConnectors, type ConnectorsHook } from '@/lib/admin/use-connectors';

export function ConnectorsSection() {
  const hook = useConnectors();
  return (
    <>
      <SectionHeader
        kicker="surface · integrations"
        title="connectors"
        count={titleCount(hook)}
      />
      <Intro />
      <Grid hook={hook} />
    </>
  );
}

function titleCount(hook: ConnectorsHook): string {
  const total = hook.connectors.length;
  const on = hook.connectors.filter((c) => c.connected).length;
  return `${on} of ${total}`;
}

function Intro() {
  return (
    <p className="reading-tight text-(--color-muted) mb-6 text-[15px] max-w-[54em]">
      Coming soon. Connectors pull from external sources (Gmail / Calendar / Slack) into your raw
      inbox, and let visitors chat with you from inside IM apps. None are wired yet — toggle for
      preview only.
    </p>
  );
}

function Grid({ hook }: { hook: ConnectorsHook }) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
      {hook.connectors.map((c) => (
        <ConnectorTile key={c.id} connector={c} onToggle={() => hook.toggle(c.id)} />
      ))}
    </div>
  );
}
