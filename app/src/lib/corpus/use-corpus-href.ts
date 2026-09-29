// use-corpus-href —— carry the reader's current language along when following a link.
//
// `?lang=zh` switches **this one** note's side, but the reader doesn't read
// just one: pick a language, then click another node in the tree, and that
// link is bare `/wiki/<path>` — the language is gone on the spot, and the
// click lands back in English. **A choice you can only make once is the same
// as not having the choice** (owner's own words: "then what's the point of it").
//
// Why fix it here: a corpus item's address has exactly one home (`corpusHref`,
// see the account at the top of href.ts). Language is part of the address, so
// it belongs in that same home — otherwise it's 34 call sites each having to
// remember to append `?lang=`, which is the same shotgun firing again.
//
// Why still go through the URL instead of storing it: the address carries the
// language, so a shared link shows the same side to whoever opens it, a
// crawler indexes that same side, and the back button returns to the previous
// language. These are the three reasons LanguageSwitch chose the URL in the
// first place, and none of them changed. What's added here is just "carry it
// forward when navigating too".

'use client';

import { useSearchParams } from 'next/navigation';
import { corpusHref, withLang, type CorpusRef } from '@standmeet/sdk';

// useCorpusHref —— returns an address-building function that appends the
// reader's current language.
//
// When no language is chosen (no `?lang=` on the URL) it's byte-identical to
// `corpusHref` — it never invents a `?lang=` out of nowhere, because "nothing
// chosen" and "the default was chosen" aren't the same thing: the latter
// would override a note's own identity language.
export function useCorpusHref(): (ref: CorpusRef) => string {
  const lang = useSearchParams()?.get('lang') ?? '';
  return (ref: CorpusRef) => withLang(corpusHref(ref), lang);
}

// Citations under an answer and links inside a rendered body carry the language too; those are the
// chat's own links and live with it (@standmeet/sdk, src/chat/reader-lang.ts).

