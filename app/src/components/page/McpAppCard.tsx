// McpAppCard —— Phase F: sandboxed rendering of the ui:// card an externalized
// MCP app capability ships with itself.
//
// An externalized capability's server (e.g. ask_visitor) serves its own
// ui:// HTML card (read into CapabilityState.extra.ui.html at assembly
// time). This component drops it into a sandboxed iframe (allow-scripts, no
// same-origin → can't reach the parent page's cookies/DOM); the protocol
// lives in use-mcp-app-card. The capability shipping its own rendering makes
// it truly self-contained, replacing the hardcoded AskVisitorCard.

'use client';

import { useMcpAppCard } from '@/lib/visitor/use-mcp-app-card';
import type { ToolCallView } from '@/lib/page/use-chat';

interface Props {
  call: ToolCallView;
  html: string;
  // onAsk —— only interactive cards (ask_visitor / slots) need to forward the
  // visitor's choice into the next turn; read-only cards (corpus hits /
  // report) don't submit, so this can be omitted and submit becomes a no-op.
  onAsk?: (q: string) => void;
  // conversationID —— a booked card's mcp-ui:tool dispatch (cancel /
  // send_confirmation) uses this plus the visitor session to call the tool;
  // cards that don't dispatch a tool can omit it.
  conversationID?: string;
  // noteEvent —— a tool call dispatched from a card must go into this
  // conversation's history, otherwise the agent won't know on the next turn
  // that the visitor just canceled that booking (F-B-9).
  noteEvent?: (text: string) => void;
}

// This component only forwards props to the hook — defaults live on the
// hook's side (`CardWiring`). Adding `??` fallbacks here would add a branch
// per optional prop, and the gate would (rightly) block it.
export function McpAppCard({ call, html, onAsk, conversationID, noteEvent }: Props) {
  const { ref, height } = useMcpAppCard({
    result: call.result, tool: call.name, onAsk, conversationID, noteEvent,
  });
  return (
    <iframe
      ref={ref}
      data-testid={`mcp-app-card-${call.name}`}
      title={`${call.name} card`}
      sandbox="allow-scripts"
      srcDoc={html}
      // eslint-disable-next-line no-restricted-syntax -- height is runtime-dynamic (posted by the sandboxed card)
      style={{ width: '100%', height, border: 'none', display: 'block' }}
    />
  );
}
