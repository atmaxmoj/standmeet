// app-health — is **this app itself** still alive. Does not touch the backend.
//
// Why this needs its own route: the container health check used to hit `/api/v1/instance`,
// which `afterFiles` proxies to the backend — so it measured **two hops** (app → backend)
// with only a 3s timeout. When the backend is slow (measured 6.8s on this machine), a fully
// healthy app gets judged unhealthy: compose's `--wait` fails, the orchestrator restarts a
// component that isn't broken, and every e2e `ensureStackUp` turns red along with it. The
// health check was testing its dependency, not itself.
//
// Whether a dependency is healthy is answered by **that dependency's own** health check
// (backend has `/internal/healthz`, db/redis each have theirs). One component reporting
// health on behalf of another lets bad news propagate while good news doesn't come back.
//
// Placed under `/api/` instead of at the root: the root has the `[handle]` dynamic route
// (the owner's public page), and an extra static segment would add ambiguity there. The
// app's own route handler runs before the `afterFiles` proxy, so this route never gets
// forwarded to the backend; if this file ever disappears, the request falls through to
// the backend and 404s, so `wget` exits non-zero — it can't fail silently.

import { NextResponse } from 'next/server';

export function GET(): NextResponse {
  return NextResponse.json({ ok: true, service: 'app' });
}
