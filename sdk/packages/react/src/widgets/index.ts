// widgets —— the central, managed set of drop-in site widgets a microsite composes. A page
// author never hand-writes these; they import the named widget and place it. The MCP
// microsite.guide points the owner's agent here.

export { CorpusWidget } from './CorpusWidget.js';
export type { CorpusWidgetProps } from './CorpusWidget.js';
export { AgentWidget } from './AgentWidget.js';
export type { AgentWidgetProps } from './AgentWidget.js';
export { GateWidget } from './GateWidget.js';
export type { GateWidgetProps } from './GateWidget.js';
export { PageNavWidget } from './PageNavWidget.js';
export type { PageNavWidgetProps } from './PageNavWidget.js';
