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
export type {
  PageProject,
  PageInsight,
  PageWhere,
  PageContact,
  PageContent,
  PublicOwnerView,
  PublicPageView,
  WikiLandingView,
  OutputLandingView,
  PublicSessionResponse,
  SSEEvent,
  SSETokenEvent,
  SSEDoneEvent,
  SSEErrorEvent,
  CitedRef,
  SessionMode,
} from './types.js';
