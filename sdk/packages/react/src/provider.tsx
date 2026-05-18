// provider.tsx —— context 把 createClient 出来的实例传下去；hook
// useStandMeet() 读它。SSR-safe：provider 接收 client 实例（已构造好的）
// 而不是 baseURL，让 server component 也能在 root 处构造一次。
//
// 显式 typing 让 useStandMeet() 在没 provider 时 throw，不返 undefined。

import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { StandMeetClient } from '@standmeet/sdk-core';
import { createClient } from '@standmeet/sdk-core';

const ClientContext = createContext<StandMeetClient | null>(null);

export interface ProviderProps {
  client?: StandMeetClient;
  baseURL?: string;
  children: ReactNode;
}

export function StandMeetProvider(props: ProviderProps): ReactNode {
  const value = useMemo(
    () => props.client ?? createClient({ baseURL: props.baseURL ?? '' }),
    [props.client, props.baseURL],
  );
  return <ClientContext.Provider value={value}>{props.children}</ClientContext.Provider>;
}

export function useStandMeet(): StandMeetClient {
  const c = useContext(ClientContext);
  if (!c) throw new Error('useStandMeet must be used inside <StandMeetProvider>');
  return c;
}
