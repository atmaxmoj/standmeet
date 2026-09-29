// @standmeet/sdk (React) —— the one chat, and the client around it.
//
// The chat lives here and only here (docs/design/sdk-chat-inheritance.md): the engine, the
// transcript, the composer, the dock. The app renders it; a microsite renders it (<AgentWidget>,
// <Agent>); the embed renders it. A chat feature is written in src/chat and every surface has it.
// Styles: import '@standmeet/sdk/styles.css' once.

import './chat/chat.css';

export { StandMeetProvider, useStandMeet } from './provider.js';

// The chat —— surfaces.
export { Agent } from './chat/Agent.js';
export type { AgentProps, AgentLayout } from './chat/Agent.js';
export { ChatTranscript, ChatProgress } from './chat/ChatTranscript.js';
export { Composer, tryVisible } from './chat/Composer.js';
export { FloatingChatDock } from './chat/FloatingChatDock.js';
export { ChatMarkdown, CORPUS_REMARK_PLUGINS } from './chat/markdown.js';
export { ChatLangProvider } from './i18n.js';
export {
  escapeCurrencyDollars, isMermaidCode, mermaidSource, promoteDisplayMath,
} from './chat/markdown-helpers.js';
export { MermaidBlock } from './chat/MermaidBlock.js';
export { DiagramDiagnostics } from './chat/diagram-diagnostics.js';
// The chat —— state.
export { useChatController, useChatRoomDerived } from './chat/chat-controller.js';
export { useChat } from './chat/use-chat.js';
export type { SessionMode, ChatState as ChatEngineState } from './chat/use-chat.js';
export { seedEphemeralStores } from './chat/use-chat-restore.js';
export {
  useVisitorSessionStore, bindVisitorSessionSync, peekStoredSession, useVisitorChatAvailable,
  useIsQuotaExhausted,
} from './chat/session-store.js';
export type { VisitorSession } from './chat/session-store.js';
export { persistSession, loadStoredSession, clearStoredSession } from './chat/stored-session.js';
export type { StoredVisitorSession } from './chat/stored-session.js';
export { usePendingCodeStore } from './chat/use-pending-code-store.js';
export { clearAndPreserveCode } from './chat/session-recovery.js';
export { issueCodeSession, issueBYOAISession, setChatBaseURL } from './chat/api.js';
export type { IssueCodeSessionInput, IssueBYOAISessionInput } from './chat/api.js';
// A corpus item's public address (one home) and the reader's language carried along it.
export { corpusHref, citationHref } from './chat/href.js';
export type { CorpusGenre, CorpusRef } from './chat/href.js';
export { isCorpusPath, withLang, ReaderLangProvider } from './chat/reader-lang.js';

// For an author drawing their own chat: the chat as plain state + its answer renderer.
export { useChatSession } from './use-chat-session.js';
export type { ChatMessage, ChatState, ChatTool } from './use-chat-session.js';
export { useMicrositeStore } from './use-microsite-store.js';
export type { MicrositeStore } from './use-microsite-store.js';
export { MicrositeStoreError } from '@standmeet/sdk-core';
export type { MicrositeDoc } from '@standmeet/sdk-core';
export { AnswerText } from './AnswerText.js';
export type { AnswerTextProps } from './AnswerText.js';
export { usePageLang, usePageTheme } from './page-prefs.js';
export type { PageTheme } from './page-prefs.js';

// Site widgets —— the central, managed drop-in blocks a microsite composes (corpus browser,
// agent entry, gate CTA, nav to the owner's other pages). See src/widgets/.
export {
  CorpusWidget, AgentWidget, GateWidget, PageNavWidget, AssetWidget, BlockWidget, useBlockTool,
} from './widgets/index.js';
export type {
  CorpusWidgetProps, AgentWidgetProps, GateWidgetProps, PageNavWidgetProps, AssetWidgetProps,
  BlockWidgetProps, UseBlockTool,
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
