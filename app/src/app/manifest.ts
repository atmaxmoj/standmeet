// manifest.ts —— the PWA manifest (served at /manifest.webmanifest, auto-linked on every page). It
// lets the owner add /cue to the phone's home screen and open it standalone (no browser chrome),
// like a native cue app. start_url points at /cue so the icon opens straight to the live cards.

import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'StandMeet Cue',
    short_name: 'Cue',
    description: 'Live interview cue cards from your StandMeet corpus — the desktop app captures, this shows the cards.',
    start_url: '/cue',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#14110D',
    theme_color: '#14110D',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
