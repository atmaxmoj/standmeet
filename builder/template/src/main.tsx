// main.tsx — builder template entry. Mounts the owner's default-exported
// component to #root. runner.mjs writes src/owner-entry.tsx → owner/<entry>.
import { createRoot } from 'react-dom/client';

import './theme.css'; // the StandMeet design system (tokens + fonts + base), for every page.
import OwnerApp from './owner-entry';

const el = document.getElementById('root');
if (el) createRoot(el).render(<OwnerApp />);
