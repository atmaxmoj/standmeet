// tool-specs-store.ts —— G-8: the visitor session's tool_specs get dumped
// wholesale into this zustand store, indexed by name; ConversationDeck /
// ChatRoom read progress_label by tool name when rendering the throbber.
// ensureSession fills it in one shot when a session is issued; reset goes
// through clear.
//
// Fixes the hardcoded THROBBER_LABELS duplication left over from D-5:
//   - which label a running tool shows is decided by the backend's
//     ToolSpec.ProgressLabel
//   - the frontend only observes (zustand subscribe), no longer maintains
//     its own list

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

import type { PublicSessionToolSpec } from '@standmeet/sdk-core';

interface ToolSpecsState {
  // Indexed by name; undefined means the backend didn't send one
  // (fallback to "running <name>")
  byName: Record<string, PublicSessionToolSpec>;
  setSpecs: (specs: readonly PublicSessionToolSpec[]) => void;
  clear: () => void;
}

export const useToolSpecsStore = create<ToolSpecsState>()(
  subscribeWithSelector((set) => ({
    byName: {},
    setSpecs: (specs) => set({ byName: indexByName(specs) }),
    clear: () => set({ byName: {} }),
  })),
);

function indexByName(
  specs: readonly PublicSessionToolSpec[],
): Record<string, PublicSessionToolSpec> {
  const out: Record<string, PublicSessionToolSpec> = {};
  for (const s of specs) out[s.name] = s;
  return out;
}

// uiHtmlForTool —— the ui:// card HTML this tool carries (#134 / MCP Apps,
// per-tool). Looked up by exact tool name (a plugin declares it via the
// tool's `_meta.ui_resource`); none → '' (no card).
export function uiHtmlForTool(
  byName: Record<string, PublicSessionToolSpec>, toolName: string,
): string {
  return byName[toolName]?.ui_html ?? '';
}
