// credFieldLabel —— the human-readable print of a credential field key.
//
// The key is the name in the API contract (`from_address`), the label is what
// a human reads. Known keys have a translated label under
// `adminIntegrations.credField.*`; the display resolves from there via the
// caller's `t` (that's why this takes the translator — the key→label mapping
// still has exactly one home, and both render sites go through it,
// [[lesson-not-swept-to-neighbours]]).
//
// Field names are derived by the backend from each supplier’s own declaration,
// so an arbitrary/unknown key can arrive. For those there is no message: fall
// back to the raw key with underscores turned into spaces (`from_address` →
// `from address`) — never render a raw error string.
//
// Why this is its own file: **credential fields are rendered in two places**
// (`CredField` on the supplier card, `PlainField` in the assemble form), and
// they have different responsibilities (one handles scopes/readonly, the
// other only handles key-value), so merging them would drop something
// ([[duplicate-carries-a-unique-job]]). But "how does a key become a label"
// should have exactly one answer.
//
// Rendering only: testid, the key sent over the wire, and the backend contract all keep their original keys.
import type { useTranslations } from 'next-intl';

type Translator = ReturnType<typeof useTranslations>;

export function credFieldLabel(t: Translator, key: string): string {
  const path = `credField.${key}`;
  return t.has(path) ? t(path) : key.replaceAll('_', ' ');
}
