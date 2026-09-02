// PartialNotice —— "this turn hit its limit". Rendered separately from
// the answer body, because **a chunk of truncated text** and **the fact
// that it was truncated** are two different things; mixed into the body
// it reads as if the author wrote it that way on purpose (F-A-32).
//
// The look isn't invented here (UX-84): this is the same category of event
// as "this session is done" — a quota ran out and the product pauses to
// say so. On the other side of that 50/50 split is `SESSION FULL`
// (`ChatRoom.tsx`'s `ComposerAction`: vermillion, mono, uppercase, 0.16em
// tracking), so this side uses the same type treatment. The original
// version was a self-invented vermillion vertical bar + a lowercase
// sentence — never actually designed, and it made the same category of
// event look like two different things in two places.
//
// Why a component: the two chat surfaces (`ChatTranscript` and
// `ConversationDeck`) used to each carry their own copy of an **identical**
// implementation and testid — which meant the next change would only ever
// reach one of them ([[lesson-not-swept-to-neighbours]]).

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
