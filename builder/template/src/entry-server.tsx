// entry-server.tsx — the build's SSR entry. renderToString(<App/>) produces the static HTML the
// builder injects into dist/index.html (prerender.mjs), so a no-JS reader (crawler / AI / link bot)
// gets the page's prose in the initial bytes. This runs in Node at build time, not the browser, so
// it imports neither theme.css nor track — only the owner's component.
import { renderToString } from 'react-dom/server';

import OwnerApp from './owner-entry';

export function render(): string {
  return renderToString(<OwnerApp />);
}
