// cue/layout —— /cue runs full-bleed on a phone (standalone PWA / the native shell's web view), so it
// must own the safe area: viewport-fit=cover lets the page read env(safe-area-inset-*), and the page
// then pads itself off the notch / Dynamic Island and the home indicator. (page.tsx is a client
// component and cannot export viewport itself, so it lives here.)

import type { Viewport } from 'next';
import type { ReactNode } from 'react';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function CueLayout({ children }: { children: ReactNode }) {
  return children;
}
