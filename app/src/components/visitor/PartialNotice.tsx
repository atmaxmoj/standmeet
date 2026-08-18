// PartialNotice —— 「这一轮到头了」。跟正文分开渲，因为**一段被截断的文字**和**它被截断了**
// 是两件事；混进正文就读成了作者自己那么写的（F-A-32）。
//
// 长相不是这里发明的（UX-84）：这跟「这场问完了」是同一类事情 —— 一次配额到头，产品停下来
// 说一句。50/50 之后那一侧是 `SESSION FULL`（`ChatRoom.tsx` 的 `ComposerAction`：朱红、等宽、
// 大写、字距 0.16em），所以这一侧用同一套字。原来那版是我自造的朱红竖条 + 小写长句，
// 既没设计过，也让同一类事情在两处长成两个样。
//
// 为什么是组件：两个 chat 面（`ChatTranscript` 和 `ConversationDeck`）本来各抄了一份
// **一模一样**的实现和 testid —— 那意味着下一次改动只会跟到其中一处
// （[[lesson-not-swept-to-neighbours]]）。

export function PartialNotice({ notice }: { notice?: string }) {
  return notice === undefined || notice === '' ? null : (
    <div
      data-testid="answer-partial-notice"
      className="mono text-[10.5px] tracking-[0.16em] uppercase text-(--color-accent) mt-5"
    >
      {notice}
    </div>
  );
}
