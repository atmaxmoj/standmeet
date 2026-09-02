// credFieldLabel —— the human-readable print of a credential field key.
//
// The key is the name in the API contract (`from_address`), the label is
// what a human reads (`FROM ADDRESS`). Every other label in the product is
// space-separated words (`COVER LINE`, `BASE URL`, `TAGS (COMMA-SEPARATED)`);
// only the credential fields carried an underscore — sitting right next to
// the calendar card whose sentences read completely (UX-58's "two standards
// on the same panel").
//
// Why this is its own file: **credential fields are rendered in two places**
// (`CredField` on the connector card, `PlainField` in the assemble form), and
// they have different responsibilities (one handles scopes/readonly, the
// other only handles key-value), so merging them would drop something
// ([[duplicate-carries-a-unique-job]]). But "how does a key become a label"
// should have exactly one answer — otherwise the next change will only
// follow through on half of it ([[lesson-not-swept-to-neighbours]]).
//
// Rendering only: testid, the key sent over the wire, and the backend contract all keep their original keys.
export function credFieldLabel(key: string): string {
  return key.replaceAll('_', ' ');
}
