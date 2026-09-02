// GhostText —— the presentation of the ghost: a **wrapping** overlay layer
// of text, sitting under the input box.
//
// Ghost used to be rendered through the `placeholder` attribute.
// placeholder doesn't wrap — one line, clipped at the element's width, no
// ellipsis — while ghost is model-generated prose of arbitrary length, so
// every somewhat-long one got cut off mid-sentence (F-A-25). The container
// was never the bottleneck: pressing Tab pulls the same string into the
// same box as its value, and the textarea grows, wraps, and reads in full
// on its own.
//
// So this component does exactly one thing: puts that string in a real
// element and lets it wrap like normal text. The typography must match the
// input box item-for-item (font size / line height / weight / family), or
// the caret will land on a different baseline than the ghost.
//
// aria-hidden: this is a "you could ask this" hint, not page content —
// screen-reader users get the input's own accessible name instead.

import { useTranslations } from 'next-intl';

// text accepts null (nothing to render) instead of leaving that check to
// the caller — moving the check back into the caller would add one more
// branch to ComposerForm, which is already at its complexity-3 ceiling.
export function GhostText({ text }: { text: string | null }) {
  return text === null ? null : (
    <>
      {/* The hint is a **sibling** of the ghost, not part of it: the
          `chat-ghost-text` element must still carry exactly the full ghost
          string, not one character more (`visitor-ghost-readable` asserts
          this verbatim). The first version stuffed the hint into this
          element, and that assertion immediately went red — and per the
          owner's stated boundary, a design change must not touch any
          existing assertion. */}
      <div
        aria-hidden
        data-testid="chat-ghost-text"
        className="pointer-events-none whitespace-pre-wrap break-words text-(--color-faint) font-serif text-[22px] leading-[1.4] font-[380]"
      >
        {text}
      </div>
      <AcceptHint />
    </>
  );
}

// AcceptHint —— "this can be pulled in with Tab".
//
// Tab has always been able to accept it (`dispatchGhostKey` intercepts Tab
// and calls onAccept), but **nothing on screen said so**: the ghost is a
// pale serif text sitting in the input box, looking identical to the
// `ask…` placeholder, so the visitor had no reason to think it could be
// accepted, nor any way to know whether ignoring it would lose something
// (UX-34).
//
// **It gets its own line, no longer riding on the tail of the sentence**:
// the first version positioned it absolutely in the bottom-right corner,
// betting the ghost's last line would never reach there. That broke the
// first time it was driven in a real environment — the model-generated
// ghost is prose of arbitrary length, and a two-line one had its last line
// run straight through the hint (`chat-ghost/shots/gx-11`, UX-83). Giving
// it its own line makes overlap impossible, instead of betting on how long
// the text will be (the same lesson as
// [[computed-class-generates-nothing]]: a layout that only holds by
// coincidence stops holding the moment the data changes).
function AcceptHint() {
  const t = useTranslations('visitor.chatRoom');
  return (
    <div
      aria-hidden
      data-testid="chat-ghost-accept-hint"
      className="pointer-events-none mt-0.5 text-right mono text-[10px] tracking-[0.14em] uppercase text-(--color-faint)"
    >
      {t('ghostAccept')}
    </div>
  );
}
