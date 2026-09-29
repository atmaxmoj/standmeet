// AgentWidget —— the name microsites already import for the agent. It IS <Agent> (chat/Agent.tsx):
// the same conversation, transcript and composer the app renders, inheriting everything the access
// code grants. `layout` picks where it sits: inline (default, where the author put it), rail (a
// column beside the page; the floating dock on a narrow screen) or dock.
//
// The parity that "the embedded agent inherits everything the non-embedded one grants" is enforced
// by tests (agent-widget-inherits-from-code, agent-inherits-app-chat), not asserted here.

'use client';

export { Agent as AgentWidget } from '../chat/Agent.js';
export type { AgentProps as AgentWidgetProps } from '../chat/Agent.js';
