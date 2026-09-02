// instance-liveness —— what the dot in the top bar actually says.
//
// F-N-6: `TopBar`'s `LiveDot` had no input at all — dev, prod, and a downed
// backend all looked identical. Stop the backend on prod for real, click a
// sidebar section: the body reports that section failed to load, while the
// top bar still shows `● LIVE`.
// A status dot wired to no status isn't a dot, it's decoration — and it
// occupies exactly the spot that should answer "is this machine okay right now".
//
// Where the signal comes from: **every admin request goes through
// `lib/api/admin`**, which already knows both success and failure.
// So instead of inventing a new heartbeat (one more poll is one more piece of
// state that can drift from the truth), we just record what already happened:
//   - any 2xx  → this machine just answered
//   - 5xx / network failure → it isn't answering right now (4xx doesn't count:
//     that means this particular request was invalid, the machine is fine)
//
// Only "unreachable" flips the dot — counting 403 in would make a normal
// permission denial look like the whole instance died.

import { create } from 'zustand';

export type InstanceLiveness = 'live' | 'unreachable';

interface LivenessState {
  liveness: InstanceLiveness;
  set: (v: InstanceLiveness) => void;
}

const useLivenessStore = create<LivenessState>((set) => ({
  liveness: 'live',
  set: (v) => set((s) => (s.liveness === v ? s : { ...s, liveness: v })),
}));

export function useInstanceLiveness(): InstanceLiveness {
  return useLivenessStore((s) => s.liveness);
}

export function markInstanceAnswered(): void {
  useLivenessStore.getState().set('live');
}

// markInstanceUnreachable —— status 0 means the request never made it out (network layer).
export function markInstanceUnreachable(status: number): void {
  if (status === 0 || status >= 500) useLivenessStore.getState().set('unreachable');
}
