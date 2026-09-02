// dock-buttons-store.ts —— #109/#110 global store for the visitor session's
// chat dock buttons. Set once from the `dock_buttons` field in the POST
// /api/v1/sessions response (the ≤2 the owner configured on the role,
// already filtered by code-deny); ChatRoom reads it to render the two
// button slots, and a click sends the trigger as a visitor message.

import { create } from 'zustand';

import type { PublicSessionDockButton } from '@standmeet/sdk-core';

interface DockButtonsStoreState {
  buttons: readonly PublicSessionDockButton[];
  setButtons: (b: readonly PublicSessionDockButton[]) => void;
  clear: () => void;
}

export const useDockButtonsStore = create<DockButtonsStoreState>()((set) => ({
  buttons: [],
  setButtons: (b) => set({ buttons: b }),
  clear: () => set({ buttons: [] }),
}));
