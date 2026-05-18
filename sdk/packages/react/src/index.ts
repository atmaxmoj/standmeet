// @standmeet/sdk (React) —— context + hooks 包装 @standmeet/sdk-core。
//
// 用法：
//   <StandMeetProvider baseURL="">
//     <App />  // 内部 useStandMeet().fetchPage('sijie') 等
//   </StandMeetProvider>
//
// React 这层不内置 UI 组件 —— UI 形态由 caller 自己定，hook 只暴露 API
// 客户端 + 一个 useChatSession 的状态机（streaming → tokens → done）。

export { StandMeetProvider, useStandMeet } from './provider.js';
export { useChatSession } from './use-chat-session.js';
export type { ChatMessage, ChatState } from './use-chat-session.js';
