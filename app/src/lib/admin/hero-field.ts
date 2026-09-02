// heroField —— what to send on submit for the three hero fields (cover image
// / the line laid over it / tone).
//
// These three backend columns are **pointer fields**: not sending = leave
// unchanged, sending an empty string = clear it. Both forms used to write
// "don't send an empty string", so all three were **write-only, never
// clearable** — after the owner picked a tone once, clicking `— default —`,
// saving, and reopening still showed the same tone (verified in prod: violet
// → `— default —` → still violet). It looked like he'd made a choice, and he
// had no way to undo it (F-L-38(a)).
//
// The dividing line isn't "empty or not", it's "changed compared to what was
// loaded":
//   - loaded empty, still empty now → he never touched this field (a new form
//     always takes this path) → **don't send**, otherwise "never set" gets
//     written as "explicitly cleared", and those are not the same thing on the backend;
//   - has a value now → send that value;
//   - loaded had a value, now empty → **send an empty string**, that's exactly "revoke".
export function heroField(current: string, loaded: string): string | undefined {
  return current === '' && loaded === '' ? undefined : current;
}
