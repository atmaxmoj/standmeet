// selfstat — THIS app container's own resource usage, read from its cgroup v2 files (no docker
// socket), for the admin System panel's "own containers". Logic lives in lib/selfstat; this route
// is a thin forwarder. Node runtime + force-dynamic: reads /sys/fs/cgroup live, never prerendered.

import { NextResponse } from 'next/server';

import { read } from '@/lib/selfstat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): Promise<NextResponse> {
  return read()
    .then((s) => NextResponse.json(s))
    // No cgroup (non-linux / not mounted) → tell the gatherer to drop this row (non-200 = absent).
    .catch(() => NextResponse.json({ error: 'cgroup unavailable' }, { status: 503 }));
}
