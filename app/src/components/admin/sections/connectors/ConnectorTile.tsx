// ConnectorTile —— 单个 connector 卡。connect / manage 按钮只动 local state。

import { Btn } from '../../atoms/Btn';

import type { ConnectorView } from '@/lib/admin/use-connectors';

type Props = { connector: ConnectorView; onToggle: () => void };

export function ConnectorTile({ connector, onToggle }: Props) {
  return (
    <article className="border border-(--color-rule) p-5 rounded-sm bg-(--color-surface)/30 flex flex-col">
      <TileHead connector={connector} />
      <p className="reading-tight text-(--color-muted) mb-4 text-[14.5px]">{connector.note}</p>
      <TileFoot connector={connector} onToggle={onToggle} />
    </article>
  );
}

function TileHead({ connector }: { connector: ConnectorView }) {
  return (
    <div className="flex items-baseline justify-between mb-2">
      <h3 className="font-serif text-(--color-ink) text-[19px] font-medium">{connector.name}</h3>
      <Status connected={connector.connected} />
    </div>
  );
}

function Status({ connected }: { connected: boolean }) {
  const cls = connected ? 'text-(--color-accent)' : 'text-(--color-faint)';
  return (
    <span className={`mono text-[10px] tracking-[0.16em] uppercase ${cls}`}>
      {connected ? '● connected' : '○ coming soon'}
    </span>
  );
}

function TileFoot({ connector, onToggle }: { connector: ConnectorView; onToggle: () => void }) {
  return (
    <div className="mt-auto pt-3 border-t border-(--color-rule)/60 flex items-baseline justify-between gap-3">
      <FootMeta connector={connector} />
      <Btn size="sm" kind={connector.connected ? 'ghost' : 'outline'} onClick={onToggle}>
        {connector.connected ? 'manage' : 'connect ↗'}
      </Btn>
    </div>
  );
}

function FootMeta({ connector }: { connector: ConnectorView }) {
  return (
    <div className="mono text-[10.5px] tracking-[0.06em] text-(--color-muted) min-w-0">
      <AccountLine account={connector.account} />
      <EventLine event={connector.last_event} />
    </div>
  );
}

function AccountLine({ account }: { account?: string }) {
  return account
    ? <div>{account}</div>
    : <div className="text-(--color-faint)">no account linked</div>;
}

function EventLine({ event }: { event?: string }) {
  return event ? <div className="text-(--color-faint)">{event}</div> : null;
}
