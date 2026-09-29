// thinking-words —— the rotating word bank for the throbber while the LLM
// is thinking (no concrete tool running).
//
// When the throbber has a real action it shows "searching X" / "reading
// Y"; between actions, and during the final stretch where the agent is
// composing the answer, the agent is just thinking, with no concrete
// action to report — at that point it pulls a word from the bank every
// 3 seconds, which feels more alive than a flat, static "thinking", and
// keeps a long wait (a real LLM turn can take tens of seconds) from
// looking stuck.
//
// The words weren't picked off the top of my head: they're synonym verbs
// pulled from thesaurus.com under the ponder / contemplate / deliberate
// headwords, with the obscure ones filtered out (excogitate / cerebrate /
// perpend / woolgather) along with ones that clash with the tone
// (speculating / brooding —— a grounded-answer tool shouldn't look like
// it's guessing wildly or brooding), plus one addition from compose
// (composing / drafting, for the stretch where it's putting the answer
// into words). All of them are verbs for "a person weighing things,
// organizing a grounded answer", matching StandMeet's calm, anti-hype
// tone.

'use client';

import { useEffect, useState } from 'react';

export const THINKING_WORDS = [
  'thinking',
  'considering',
  'contemplating',
  'deliberating',
  'pondering',
  'reflecting',
  'weighing',
  'mulling',
  'musing',
  'reasoning',
  'ruminating',
  'composing',
  'drafting',
] as const;

const ROTATE_MS = 3_000;

// useThinkingWord —— advances one word every 3 seconds while mounted,
// returns the current word. Every pending segment remounts → starts back
// at 'thinking'. Unmounting the component (answer arrives / turn lands)
// clears the interval.
export function useThinkingWord(): string {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => n + 1), ROTATE_MS);
    return () => clearInterval(id);
  }, []);
  return THINKING_WORDS[i % THINKING_WORDS.length] ?? 'thinking';
}
