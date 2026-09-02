// chunk.ts —— split an answer into pieces each platform will accept.
//
// **Why splitting is required**: Telegram caps a single message at 4096 characters,
// Discord at 2000. The owner's corpus routinely answers in two or three thousand
// characters (measured 2847 in this round on the custom page). Not splitting doesn't
// just mean "truncated display" — the platform rejects the message outright, the
// reader **gets nothing at all**, and the log shows only a 400.
//
// The stand-in has nothing to say about this: it accepts any length. So this layer's
// pass/fail criterion has to be established on its own.

/** DEFAULT_LIMIT —— the tighter of the two platforms (Discord's 2000), with a little headroom. */
export const DEFAULT_LIMIT = 1900;

/**
 * chunkForChat —— split on **semantic boundaries**, not a hard character cut.
 *
 * The order matters: blank lines (paragraphs) first, then line breaks, then
 * sentence-ending punctuation, and only then a hard cut. A hard cut can slice a
 * word — or even a markdown marker — in half: `**bold` lands in one message,
 * `**` in the next, and the reader sees two broken-looking messages.
 */
export function chunkForChat(text: string, limit = DEFAULT_LIMIT): string[] {
  const body = text.trim();
  if (body === '') return [];
  if (body.length <= limit) return [body];

  const out: string[] = [];
  let rest = body;
  while (rest.length > limit) {
    const cut = breakPoint(rest, limit);
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest !== '') out.push(rest);
  return out;
}

/**
 * breakPoint —— find the last decent break point within limit.
 *
 * Only hard-cuts at limit when none can be found (e.g. a long stretch of text
 * with no punctuation at all) — in that case, breaking a word is still better
 * than not sending the message at all.
 */
function breakPoint(s: string, limit: number): number {
  const window = s.slice(0, limit);
  for (const sep of ['\n\n', '\n', '。', '. ', '！', '？', '! ', '? ']) {
    const at = window.lastIndexOf(sep);
    // Skip a break point too near the start: a message with just a few dozen
    // characters looks worse than one cut mid-sentence.
    if (at > limit * 0.5) return at + sep.length;
  }
  return limit;
}
