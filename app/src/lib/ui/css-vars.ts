// cssVars —— hand custom properties (`--x`) off to `style`.
//
// Why this helper exists:
// Passing custom properties gets written separately in four places, and each place ends up
// deciding its own way to do it (and last time, what each place decided was four computed
// class names, none of which generated a single line of CSS). Folding it into one named
// function leaves exactly one way to write it, and the key type bakes "only custom properties
// go here" into the signature.
//
// **Why not Tailwind's arbitrary properties** (`[--max-w:540px]`):
// That syntax only works when the value is a **literal**. The moment it's written as
// `[--max-w:${'${w}'}px]`, Tailwind's build-time scan sees an invalid string and **generates
// zero CSS** — while the class name still lands in the HTML and the variable falls back to its
// default, with no tool ever raising an error. This codebase once had four call sites written
// that way, and the consequences were: a modal permanently full-width, two progress bars stuck
// at 0%, and an editor bubble toolbar permanently pinned to the top-left. The
// check-no-computed-class.sh gate now forbids it.
//
// So a runtime-computed value has exactly one path: `style`. That's also the reason
// no-restricted-syntax leaves an escape hatch for it ("Truly runtime-dynamic values:
// single-line eslint-disable with a why").

import type { CSSProperties } from 'react';

// The parameter type restricts keys to `--*`: this function only handles custom properties,
// everything else should go through a class name.
// (No type assertion needed — an object whose keys are all `--*` is already assignable as-is;
// adding one would just get flagged as redundant by lint.)
export function cssVars(vars: Record<`--${string}`, string>): CSSProperties {
  return vars;
}
