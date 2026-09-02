// key-storage.ts —— **can this browser hold a key on the visitor's behalf
// right now** (F-D-14).
//
// The entire BYOAI path leans on `crypto.subtle` (`byoai-vault.ts` uses it
// to wrap the key, `byoai-envelope.ts` uses it to wrap the envelope). But
// `crypto.subtle` **only exists in a secure context** — https, or
// localhost. As long as a self-hosted instance hasn't put TLS on, **anyone
// opening it from another machine** (i.e. every real visitor, and the
// owner too) gets a page with no `crypto.subtle`.
//
// This used to surface only **after the button was pressed**: the
// exception bubbled up to `use-gate.ts`'s generic fallback, and the screen
// said "Couldn't check that just now. Try again." — retrying ten thousand
// times changes nothing. So the check moved to **before the door**.
//
// What's being tested is **the capability itself** (whether `crypto.subtle`
// exists), not the `isSecureContext` flag: if that's what's actually used,
// that's what should be asked. The two are equivalent in browsers today,
// and if they ever diverge, the error still points at the thing that
// actually fails.

/**
 * keyStorageAvailable —— can this realm do the Web Crypto wrapping.
 * Returns true under SSR (no window): the server-rendered frame proceeds
 * as if it were a normal deployment, and the client corrects it after
 * mount, so an https visitor doesn't get a flash of a warning first. The
 * real answer always comes from the browser.
 */
export function keyStorageAvailable(): boolean {
  if (typeof window === 'undefined') return true;
  return typeof window.crypto !== 'undefined' && window.crypto.subtle !== undefined;
}
