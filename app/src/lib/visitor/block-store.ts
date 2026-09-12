// block-store.ts —— global store for the visitor session's per-block state.
//
// Sources:
//   - The `blocks` array in the POST /api/v1/sessions response → initial setStates
//   - Any POST /sessions/{id}/tools/{name} response carries block_state →
//     updated after the dispatcher call completes (cascade invariant)
//
// Consumers:
//   - SessionStrip / banner render quota / disabled-block hints
//   - agent-core filters by enabled block when assembling the LLM toolset
//
// After H.10 the agent loop moved to the backend, so the old
// zustandBlockStateSource() adapter (used by the agent-core
// BlockStateSource port) has no importers left and was deleted.
// VisitorTurnAgent now receives updates via the SSE block_state_changed
// event instead of the port pull model.

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

import type { BlockState } from '@standmeet/agent-core';


interface BlockStoreState {
  states: readonly BlockState[];
  setStates: (s: readonly BlockState[]) => void;
  clear: () => void;
}

export const useBlockStore = create<BlockStoreState>()(
  subscribeWithSelector((set) => ({
    states: [],
    setStates: (s) => set({ states: s }),
    clear: () => set({ states: [] }),
  })),
);
