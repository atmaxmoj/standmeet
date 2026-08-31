// custom-page-imports —— 写一页自定义页时，能 import 什么。
//
// **为什么这份清单要存在**：面板上原来只有一个 slug 框和一个 textarea，起手模板是
// `<main><h1>Hello</h1></main>`。而 `builder/vendor/@standmeet/` 里**早就**装好了
// sdk / sdk-core / agent-core —— chat 接得上，只是屏幕上一个字都没说。
// owner 2026-08-30 自己撞上：「我想引用我们的 chat 功能，我完全不知道写什么」。
//
// ⚠️ 这份清单是 builder 实际 vendor 的那份东西的**第二份表示**，会漂移，而漂移的方向
// 恰好最坏：面板说能用，构建时报 module not found，owner 以为是自己写错了。
// `infra/scripts/check-custom-page-imports-declared.sh` 就是那道闸门 ——
// 这里提到的每个 `@standmeet/*`，builder 必须 vendor 了它。

export interface ImportableModule {
  module: string;
  // exports —— 这个包里 owner 最可能要的那几个名字。不求全：清单是**入口**，不是文档。
  exports: string[];
  note: string;
}

export const IMPORTABLE_MODULES: readonly ImportableModule[] = [
  {
    module: '@standmeet/sdk',
    exports: ['StandMeetProvider', 'useStandMeet', 'useChatSession', 'AnswerText'],
    note: 'React context + hooks. useChatSession runs a turn against your agent; '
      + 'AnswerText renders the inline marks in an answer.',
  },
  {
    module: '@standmeet/sdk-core',
    exports: ['createClient', 'hasVisitorGrant', 'byoaiOffered'],
    note: 'The plain client underneath, plus the grant helpers that tell you whether '
      + 'this reader arrived on a code.',
  },
  {
    module: '@standmeet/agent-core',
    exports: [],
    note: 'The agent loop primitives. You rarely need this directly — the loop runs '
      + 'on the backend.',
  },
  {
    module: 'react',
    exports: ['useState', 'useEffect'],
    note: 'React 19. react-dom is available too.',
  },
];

// STARTER —— 面板给的起手模板。
//
// 它曾经是 `<main><h1>Hello</h1></main>` —— 构建得过，但什么也没教。而**范例比说明有效**：
// 这一份顺带把两件没人说的事说了 —— 你得自己包 `<StandMeetProvider>`（builder 的
// template/src/main.tsx 不包），以及一次问答长什么样。
export const STARTER = `import { useState } from "react";
import { StandMeetProvider, useChatSession, AnswerText } from "@standmeet/sdk";

function Ask() {
  const chat = useChatSession({ mode: "public", visitor_name: "reader" });
  const [draft, setDraft] = useState("");
  const answer = [...chat.messages].reverse().find((m) => m.role === "assistant");
  return (
    <div>
      <input
        data-sm="ask"
        value={draft}
        placeholder="Ask me anything"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || draft.trim() === "") return;
          const q = draft;
          setDraft("");
          void chat.send(q);
        }}
      />
      <div data-sm="answer">{answer ? <AnswerText text={answer.text} /> : null}</div>
    </div>
  );
}

export default function App() {
  return (
    <StandMeetProvider baseURL="">
      <main>
        <h1>Ask me about my work</h1>
        <Ask />
      </main>
    </StandMeetProvider>
  );
}`;
