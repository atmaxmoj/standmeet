// app-version —— where the version number on the badge comes from.
//
// The answer is: **whatever process is actually running**. The frontend
// must not carry its own constant.
//
// The original F-C-4 fix merged two hand-typed copies into one
// (`APP_VERSION = 'v1.0.0'`), which only downgraded the contradiction from
// "two faces disagree with each other" to "one face disagrees with reality" —
// the machine was actually running 0.1.0, and /admin/system's DEPLOYMENT had
// been honestly saying so the whole time. The only reason a version number
// exists is to say clearly, when something goes wrong, which build you're on;
// a literal detached from the build cancels that reason out entirely (F-C-10).
//
// So this fetches the one the backend reports from /api/v1/instance. If that
// fails, show nothing — an empty slot says "unknown", a fake number says
// "known", and the latter is worse.

'use client';

import { useEffect, useState } from 'react';

// display —— backend reports "0.1.0", badge shows "v0.1.0". Adding the v
// happens only here, so the login page and admin header can never disagree
// on whether it's prefixed.
function display(raw: string): string {
  return raw === '' ? '' : `v${raw.replace(/^v/i, '')}`;
}

export function useAppVersion(): string {
  const [version, setVersion] = useState('');

  useEffect(() => {
    let alive = true;
    void fetch('/api/v1/instance', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : { version: '' })
      .then((data: { version?: string }) => {
        alive && setVersion(display(data.version ?? ''));
      })
      .catch(() => { /* on failure, leave it blank: no number beats a made-up one */ });
    return () => { alive = false; };
  }, []);

  return version;
}
