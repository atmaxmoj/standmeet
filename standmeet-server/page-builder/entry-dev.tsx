import React from 'react';
import { createRoot } from 'react-dom/client';

async function main() {
  // Fetch page data from Django API at runtime (proxied by Vite dev server)
  try {
    const res = await fetch('/api/dev/page-data/');
    if (res.ok) {
      const data = await res.json();
      (window as any).__STANDMEET_DATA__ = data;
    } else {
      (window as any).__STANDMEET_DATA__ = { content: [], assets: {} };
    }
  } catch {
    (window as any).__STANDMEET_DATA__ = { content: [], assets: {} };
  }
  (window as any).__STANDMEET_CONFIG__ = {};

  // Dynamically import App from the shared volume source directory
  try {
    const { default: App } = await import('./source/App');
    createRoot(document.getElementById('root')!).render(<App />);
  } catch {
    // App.tsx not yet generated — show waiting placeholder.
    // Vite HMR will auto-reload when the file appears.
    document.getElementById('root')!.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui;color:#666">
        <p>Waiting for source files...</p>
      </div>`;
  }
}

main();
