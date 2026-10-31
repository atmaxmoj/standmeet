// ask-starter-tab.ts —— the Tab behaviour of the AskAboutThis follow-up box. Extracted from the
// .tsx because the presentation layer bans `if` and caps complexity — same split as the SDK's
// ghost-text.ts.
//
// owner (2026-10-30): on the EMPTY box, Tab fills the first suggested question; once text is typed,
// or when there's no suggestion, Tab keeps its browser default (move focus to the next control).

import type { KeyboardEvent } from 'react';

// fillFirstStarterOnTab —— a keydown handler for the uncontrolled follow-up <input>. The input is
// uncontrolled (plain GET form), so it writes the value straight to the DOM node.
export function fillFirstStarterOnTab(first?: string) {
  return (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== 'Tab' || e.shiftKey) return;
    if (first === undefined || first === '' || e.currentTarget.value !== '') return;
    e.preventDefault();
    e.currentTarget.value = first;
  };
}
