// capability-store.ts —— global store for the visitor session's capability state.
//
// Sources:
//   - The `capabilities` array in the POST /api/v1/sessions response → initial setStates
//   - Any POST /sessions/{id}/tools/{name} response carries capability_state →
//     updated after the dispatcher call completes (cascade invariant)
//
// Consumers:
//   - SessionStrip / banner render quota / disabled-cap hints
//   - agent-core filters by enabled cap when assembling the LLM toolset
//
// After H.10 the agent loop moved to the backend, so the old
// zustandCapabilityStateSource() adapter (used by the agent-core
// CapabilityStateSource port) has no importers left and was deleted.
// VisitorTurnAgent now receives updates via the SSE capability_state_changed
// event instead of the port pull model.

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

import type { CapabilityState } from '@standmeet/agent-core';


interface CapabilityStoreState {
  states: readonly CapabilityState[];
  setStates: (s: readonly CapabilityState[]) => void;
  clear: () => void;
}

export const useCapabilityStore = create<CapabilityStoreState>()(
  subscribeWithSelector((set) => ({
    states: [],
    setStates: (s) => set({ states: s }),
    clear: () => set({ states: [] }),
  })),
);
