// custom-page-imports —— what you can import when writing a custom page.
//
// **Why this list needs to exist**: the panel used to have just a slug box
// and a textarea, with `<main><h1>Hello</h1></main>` as the starter
// template. Meanwhile sdk / sdk-core / agent-core were **already** installed
// under `builder/vendor/@standmeet/` — chat was already wired up, the screen
// just never said so. The owner ran into this themselves on 2026-08-30: "I
// want to reference our chat feature, I have no idea what to write."
//
// Warning: this list is a **second representation** of what the builder
// actually vendors, and it can drift — in exactly the worst direction: the
// panel says it works, the build reports module not found, and the owner
// thinks they made a mistake. `infra/scripts/check-custom-page-imports-declared.sh`
// is the gate for that — every `@standmeet/*` mentioned here must be vendored by the builder.

export interface ImportableModule {
  module: string;
  // exports —— the names in this package an owner is most likely to want. Not exhaustive: this list is an **entry point**, not documentation.
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

// STARTER —— the starter template the panel provides.
//
// It used to be `<main><h1>Hello</h1></main>` — it built fine, but taught
// nothing. And **an example teaches better than an explanation**: this one
// quietly says two things nobody else said — you have to wrap
// `<StandMeetProvider>` yourself (the builder's template/src/main.tsx
// doesn't), and what one question-and-answer actually looks like.
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
