// ghost-text —— presentation helper for the H.13.d ghost text trio. The
// components layer bans `if` and caps complexity at 3, so this bit of
// conditional logic — picking which ghost to render, picking the
// placeholder, keyboard dispatch — is extracted here. Shared by every
// AskInput / ChatRoom input box / FloatingChatDock input box.

import type { KeyboardEvent } from 'react';

interface GhostGate {
  // The ghost only shows when value === ''; a non-empty value means the
  // visitor is already typing.
  value: string;
  // pending / locked / disabled being true → don't render the ghost (the
  // input box is dimmed).
  blocked: boolean;
  ghost: string | null | undefined;
}

// pickGhost —— the ghost that should render right now; null means none.
export function pickGhost(g: GhostGate): string | null {
  if (g.blocked) return null;
  if (g.value !== '') return null;
  if (g.ghost === undefined || g.ghost === null || g.ghost === '') return null;
  return g.ghost;
}

interface PlaceholderInputs {
  // locked = a hard lock like quota exhaustion; shows lockedText.
  locked: boolean;
  lockedText: string;
  // A non-empty ghost renders as the placeholder; empty falls back.
  ghost: string | null;
  fallback: string;
}

// composerPlaceholder —— used by the input boxes whose ghost is rendered by
// an overlay layer (the placeholder yields to empty so the two don't overlap).
//
// When a ghost is present, the placeholder must **yield to empty**:
// drawing both layers overlaps text. That's exactly what happened in
// prod — the ghost's first line ran into "ask…" and read as
// "Ẏsḵu.mentioned". e2e only measured the ghost element's geometry, which
// can't detect another string sitting behind it — that was caught by eye.
//
// locked still overrides everything: when locked the input box is
// disabled and pickGhost already returns null, so this just hardcodes the
// ordering.
export function composerPlaceholder(p: PlaceholderInputs): string {
  if (p.locked) return p.lockedText;
  if (p.ghost !== null && p.ghost !== '') return '';
  return p.fallback;
}

interface GhostHandlers {
  onAccept: (g: string) => void;
}

// dispatchGhostKey —— Tab dispatch (P4 single ghost: Esc no longer cycles,
// there's no next one to switch to). Tab calls onAccept + preventDefault;
// any other key, or an empty ghost, is a no-op.
export function dispatchGhostKey(
  e: KeyboardEvent<HTMLElement>,
  ghost: string | null,
  h: GhostHandlers,
): void {
  if (ghost === null || ghost === '') return;
  if (e.key === 'Tab') {
    e.preventDefault();
    h.onAccept(ghost);
  }
}
