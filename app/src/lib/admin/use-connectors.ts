// use-connectors —— /admin/connectors 的 local-state hook。
// 完全 client-side 占位：每个 connector 默认 disconnected, click "connect" 切换
// 但不调任何 backend；目的是给设计稿 UI 一个交互形态。

import { useCallback, useState } from 'react';

export interface ConnectorView {
  id: string;
  name: string;
  note: string;
  connected: boolean;
  account?: string;
  last_event?: string;
}

const SEED: ConnectorView[] = [
  { id: 'gmail',    name: 'Gmail',    note: 'Pull threads tagged #standmeet into raw inbox.', connected: false },
  { id: 'calendar', name: 'Calendar', note: 'Let your AI offer slots from your real availability.', connected: false },
  { id: 'slack',    name: 'Slack',    note: 'Forward starred messages into raw.', connected: false },
  { id: 'telegram', name: 'Telegram', note: 'Visitors with a code can chat from inside Telegram.', connected: false },
  { id: 'discord',  name: 'Discord',  note: 'Same as Telegram, but for Discord.', connected: false },
];

export interface ConnectorsHook {
  connectors: readonly ConnectorView[];
  toggle: (id: string) => void;
}

export function useConnectors(): ConnectorsHook {
  const [connectors, setConnectors] = useState<ConnectorView[]>(SEED);
  const toggle = useCallback((id: string) => {
    setConnectors((cur) => cur.map((c) => c.id === id ? { ...c, connected: !c.connected } : c));
  }, []);
  return { connectors, toggle };
}
