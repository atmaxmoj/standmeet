// @standmeet/sdk-core —— headless API client + SSE 解析 + 公开类型。
// 给 @standmeet/sdk（React 包装）和 @standmeet/embed（Web Component 包装）
// 共享；也可直接被 Node / Deno 服务端代码消费。

export { createClient } from './client.js';
export type {
  BYOAIHeaders,
  ClientOptions,
  IssueSessionInput,
  StandMeetClient,
} from './client.js';
export { readSSE } from './sse.js';
// parseAnswerText —— 两个渲染面共用的那一半（F-O-8）：解析在这里，渲染各自实现。
export { parseAnswerText } from './answer-text.js';
export type { AnswerSpan, AnswerParagraphs } from './answer-text.js';
export type {
  PagePinCard,
  PageWhere,
  PageContact,
  PageContent,
  PublicOwnerView,
  PublicPageView,
  WikiLandingView,
  LanguageOption,
  OutputLandingView,
  PublicSessionResponse,
  PublicSessionCapability,
  PublicSessionToolSpec,
  PublicSessionDockButton,
  SSEEvent,
  SSETokenEvent,
  SSEDoneEvent,
  SSEErrorEvent,
  CitedRef,
  SessionMode,
} from './types.js';
