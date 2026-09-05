// @standmeet/sdk (React) —— context + hooks wrapping @standmeet/sdk-core.
//
// Usage:
//   <StandMeetProvider baseURL="">
//     <App />  // internally: useStandMeet().fetchPage('alice') etc.
//   </StandMeetProvider>
//
// This React layer builds in almost no UI — shape is up to the caller; the hooks
// only expose the API client plus one state machine, useChatSession
// (streaming → tokens → done).
//
// **The one exception is AnswerText** (F-O-8): the hook hands out plain text,
// but the answer carries inline markup; a host that just prints it verbatim
// would see a screen full of asterisks — that's not the host's choice, it's
// something we failed to provide, and the web component face already renders
// it correctly.

export { StandMeetProvider, useStandMeet } from './provider.js';
export { useChatSession } from './use-chat-session.js';
export type { ChatMessage, ChatState } from './use-chat-session.js';
export { usePageStore } from './use-page-store.js';
export type { PageStore } from './use-page-store.js';
export { PageStoreError } from '@standmeet/sdk-core';
export type { PageDoc } from '@standmeet/sdk-core';
export { AnswerText } from './AnswerText.js';
export type { AnswerTextProps } from './AnswerText.js';

// Site widgets —— the central, managed drop-in blocks a custom page composes (corpus browser,
// agent entry, gate CTA, nav to the owner's other pages). See src/widgets/.
export {
  CorpusWidget, AgentWidget, GateWidget, PageNavWidget,
} from './widgets/index.js';
export type {
  CorpusWidgetProps, AgentWidgetProps, GateWidgetProps, PageNavWidgetProps,
} from './widgets/index.js';

// agent-core React glue + browser adapters (H.10: the loop lives in the
// backend; the browser only uses the prompt source + agent-turn streamer)
export {
  httpPromptSource, httpAgentTurnStreamer, httpTurnRecovery,
} from './agent-adapters.js';
export type {
  HttpPromptSourceOptions, HttpAgentTurnStreamerOptions,
  HttpBYOAIHeaders, HttpTurnRecoveryOptions,
} from './agent-adapters.js';
