// @standmeet/sdk (React) —— context + hooks 包装 @standmeet/sdk-core。
//
// 用法：
//   <StandMeetProvider baseURL="">
//     <App />  // 内部 useStandMeet().fetchPage('alice') 等
//   </StandMeetProvider>
//
// React 这层几乎不内置 UI —— 形态由 caller 自己定，hook 只暴露 API 客户端 + 一个
// useChatSession 的状态机（streaming → tokens → done）。
//
// **唯一的例外是 AnswerText**（F-O-8）：hook 交出去的是纯文本，而答案里带行内标记；
// 宿主直接印出来就会看到满屏星号 —— 那不是宿主的选择，是我们少给了一件东西，
// 而 web component 那一面早就渲了。

export { StandMeetProvider, useStandMeet } from './provider.js';
export { useChatSession } from './use-chat-session.js';
export type { ChatMessage, ChatState } from './use-chat-session.js';
export { AnswerText } from './AnswerText.js';
export type { AnswerTextProps } from './AnswerText.js';

// agent-core React glue + browser adapters (H.10: loop 在 backend，
// 浏览器只用 prompt source + agent-turn streamer)
export {
  httpPromptSource, httpAgentTurnStreamer,
} from './agent-adapters.js';
export type {
  HttpPromptSourceOptions, HttpAgentTurnStreamerOptions,
  HttpBYOAIHeaders,
} from './agent-adapters.js';
