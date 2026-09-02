// provider.tsx —— a context that passes down the instance produced by
// createClient; the useStandMeet() hook reads it. SSR-safe: the provider takes
// an already-constructed client instance rather than a baseURL, so a server
// component can also construct it once at the root.
//
// Explicit typing makes useStandMeet() throw when there's no provider, instead
// of returning undefined.

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
