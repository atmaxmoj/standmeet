// ThemeSync —— **attaches** the light/dark choice made by owner/visitor **to
// `<html>`**, mounted once in the root layout.
//
// Why the root layout (UX-94): `use-theme` itself was always correct, but
// **where it got called was inside a branch** — `page-shell.tsx` is
// `isChatMode ? <ChatRoom/> : <LongScrollBody/>`, and `useTheme()` was
// written inside `LongScrollBody`. So a code-carrying visitor entering the
// chat surface never ran that hook at all: they'd clicked dark on the
// reader page, the preference was stored, but **nobody was reading it back**
// — and the chat surface is exactly the surface they spend the most time on.
//
// Mounting it at the root makes the question "does this page remember to
// read the theme" stop existing — no page needs to remember
// ([[reframes-tasks-into-enforced-invariants]]). The toggle on TopBar still
// uses the same hook to write localStorage, so both sides read the same key.

'use client';

import { useTheme } from '@/lib/page/use-theme';

export function ThemeSync() {
  useTheme();
  return null;
}
