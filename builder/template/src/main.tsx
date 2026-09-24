// main.tsx — builder template entry. Mounts the owner's default-exported
// component to #root. runner.mjs writes src/owner-entry.tsx → owner/<entry>.
import { createRoot, hydrateRoot } from 'react-dom/client';

import './theme.css'; // the StandMeet design system (tokens + fonts + base), for every page.
import { track } from './track'; // traffic instrumentation, for every page (see track.ts).
import OwnerApp from './owner-entry';

const el = document.getElementById('root');
if (el) {
  // The build prerenders the page into #root (prerender.mjs), so a no-JS reader already has the
  // prose; hydrate onto that DOM to make it interactive without a flash. If prerender was skipped
  // (empty shell fallback), there's nothing to hydrate — mount fresh.
  if (el.childElementCount > 0) hydrateRoot(el, <OwnerApp />);
  else createRoot(el).render(<OwnerApp />);
}
track();
