// btn-styles —— maps Btn's size / kind to the **`.sm-btn` atoms**.
//
// This used to be a second button implementation: its own BASE
// (mono/uppercase/tracking) + its own KIND_CLS (bg-ink / border-rule /
// muted), existing **in parallel** with `sm-atoms.css`'s `.sm-btn*` — even
// the vocabulary didn't match, that side called it `solid`, this side called it `primary`.
//
// The cost wasn't "two copies of code": `/admin/seo`'s SAVE wrote
// `className="sm-btn sm-btn-primary"` — **remembering this file's
// vocabulary, and writing it into the other file's namespace**.
// `sm-btn-primary` generates zero CSS, so that primary action silently fell
// back to bare `.sm-btn`, rendering lighter than the secondary link next to
// it (UX-74②). Having two definitions coexist isn't just duplication, it
// **produces** this class of bug.
//
// Now there's only one set of definitions (the CSS atoms); this file only
// does name mapping. `kind`'s values were changed to match the atoms'
// vocabulary too: solid, not primary — one concept, one word.
// A new variant gets added in `sm-atoms.css`, not here.

import type { BtnKind, BtnSize } from '@/components/admin/atoms/Btn';

const SIZE_CLS: Record<BtnSize, string> = {
  sm: 'sm-btn-sm',
  md: '',
  lg: 'sm-btn-lg',
};

const KIND_CLS: Record<BtnKind, string> = {
  ghost:   'sm-btn-ghost',
  outline: 'sm-btn-outline',
  solid:   'sm-btn-solid',
  danger:  'sm-btn-danger',
};

export function resolveBtnClass(kind: BtnKind = 'ghost', size: BtnSize = 'md'): string {
  return `sm-btn ${KIND_CLS[kind]} ${SIZE_CLS[size]}`.trim();
}
