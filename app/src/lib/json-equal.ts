// jsonEqual —— a recursive value comparison of two JSON documents (objects, arrays, primitives).
// Used to decide "dirty" state by COMPARING the current value against a saved one, rather than
// tracking whether an edit event fired — so a change that is later undone back to the saved value
// reads as equal.

export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  // Reflect.get reads a keyed value off a narrowed `object` without a type assertion.
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k)
    && jsonEqual(Reflect.get(a, k), Reflect.get(b, k)));
}
