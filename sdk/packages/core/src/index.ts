// @standmeet/sdk-core —— headless API client + SSE parsing + public types.
// Shared by @standmeet/sdk (the React wrapper) and @standmeet/embed (the Web
// Component wrapper); can also be consumed directly by Node / Deno
// server-side code.

export { createClient } from './client.js';
export type {
  BYOAIHeaders,
  ClientOptions,
  IssueSessionInput,
  StandMeetClient,
  SystemPromptSource,
} from './client.js';
export { readSSE } from './sse.js';
// grant —— the grant the visitor already holds. A custom page adopts it
// rather than opening a fresh anonymous session of its own.
export {
  adoptStoredSession, hasVisitorGrant, pageAllowsBYOAI, byoaiOffered,
  VISITOR_SESSION_STORAGE_KEY,
} from './grant.js';
export type { AdoptedSession } from './grant.js';
// parseAnswerText —— the half shared by both rendering faces (F-O-8):
// parsing lives here, rendering is implemented separately by each.
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
