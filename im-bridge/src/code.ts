// code.ts —— recognize the **access code** a visitor brings in a DM.
//
// This is the bridge's first gate: no code, no session, same position as `/gate` on the web path.
// Recognizing it loosely is deliberate —— a person typing in a chat window won't stick to a strict
// format: they might send `/start ROOM-001`, send `ROOM-001`, send "my code is ROOM-001", or even
// send it attached to a whole sentence. All three shapes must be recognized.
//
// **But not so loose that an ordinary sentence gets mistaken for a code** —— getting it wrong isn't
// as mild as "invalid code": the product would open a session with a code that doesn't exist, then
// tell someone who just said hello "no such code", when they never mentioned a code at all.

/** Code shape: `LABEL-XXX`, uppercase letters/digits, one hyphen in the middle. Matches the access_codes side. */
const CODE = /\b([A-Z][A-Z0-9]{1,15}-[A-Z0-9]{2,16})\b/;

/**
 * findCode —— the code in the message, or an empty string if there isn't one.
 *
 * Only matches an **uppercase** shape: ordinary words in chat almost never look like `ABC-123`, but
 * once relaxed to lowercase, something like `hello-world` would get treated as a code. Better to miss
 * one and make someone resend than to mis-recognize.
 */
export function findCode(text: string): string {
  const m = CODE.exec(stripCommand(text));
  return m ? m[1]! : '';
}

/**
 * stripCommand —— strip command prefixes like `/start`, `/code`.
 *
 * Telegram's `/start <payload>` is the standard shape for arriving via a scanned QR code (the payload
 * rides inside the QR code); on Discord, people are more likely to type directly. Both land on the same
 * string before we look for a code.
 */
function stripCommand(text: string): string {
  return text.replace(/^\s*\/(start|code|begin)(@\S+)?\s*/i, ' ');
}

/** looksLikeOnlyCode —— the whole message is basically just a code (used to decide whether to also treat it as a question). */
export function looksLikeOnlyCode(text: string): boolean {
  const code = findCode(text);
  if (code === '') return false;
  const rest = stripCommand(text).replace(code, '').trim();
  return rest.length <= 2;
}
