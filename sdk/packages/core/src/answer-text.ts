// answer-text.ts —— **parses** the light inline markup in a model answer
// into paragraphs and spans. Parsing only, no rendering.
//
// Why it lives in core (F-O-8): this SDK has two rendering faces —— the web
// component assembles its own DOM nodes, the React bindings hand text to
// the host. Previously only the web component recognized `**bold**` and
// `` `code` ``, so the same product rendered as formatted text on one face
// and printed literal asterisks to the visitor on the other (a recurrence
// of the F-O-6 symptom on a different face).
//
// Parsing and rendering are kept separate because **parsing is the only
// part the two faces can share**: one needs `document.createElement`, the
// other needs React elements. Putting parsing in the shared spot and letting
// each face implement its own rendering is cleaner than having one face
// import the other's DOM code, and more reliable than writing the same
// regex twice on each side —— the second copy would eventually drift from
// the first ([[test-only-helper-rots-non-test-callers]]'s same family:
// extract a host-independent core, and route both sides through it).
//
// Recognizes only three things: paragraphs (split on blank lines),
// `**bold**`, and `` `inline code` ``. **No markdown library**: the
// rendering side goes entirely through `textContent` / React text nodes, so
// injection is impossible from the ground up and no extra sanitization
// layer is needed.

/** One span within a chunk of text: plain text, bold, italic, or inline code. */
export interface AnswerSpan { kind: 'text' | 'bold' | 'italic' | 'code'; text: string }

/** A parsed answer: an array of paragraphs, each an array of spans. */
export type AnswerParagraphs = AnswerSpan[][];

export function parseAnswerText(raw: string): AnswerParagraphs {
  const out: AnswerParagraphs = [];
  for (const para of raw.split(/\n{2,}/)) {
    if (para.trim() === '') continue;
    out.push(splitSpans(para));
  }
  return out;
}

// splitSpans —— one regex pass; only a matched pair counts as markup (a
// lone asterisk/backtick stays a plain character).
//
// **`**bold**` must come before `*italic*`**: alternation is tried
// left-to-right, and the other way around, `*` would grab `**`'s first star
// first, and bold would never match again
// ([[lookahead-rule-eats-the-neighbour]]). The italic branch also excludes
// asterisks and newlines, so it can't swallow text across paragraphs.
function splitSpans(s: string): AnswerSpan[] {
  const out: AnswerSpan[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*\n]+)\*|`([^`]+)`/g;
  let last = 0;
  for (let m = re.exec(s); m !== null; m = re.exec(s)) {
    if (m.index > last) out.push({ kind: 'text', text: s.slice(last, m.index) });
    out.push(spanOf(m));
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ kind: 'text', text: s.slice(last) });
  return out;
}

function spanOf(m: RegExpExecArray): AnswerSpan {
  if (m[1] !== undefined) return { kind: 'bold', text: m[1] };
  if (m[2] !== undefined) return { kind: 'italic', text: m[2] };
  return { kind: 'code', text: m[3] ?? '' };
}
