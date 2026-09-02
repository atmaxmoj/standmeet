// Streaming reverse-proxy Route Handler for /api/v1/agent/turn.
//
// Why not go through next.config's rewrites(): that proxy buffers the upstream SSE —
// measured: the backend flushes every frame (tool_started/… arrives early), but the
// browser only gets all frames at once after the whole turn ends. Result: the throbber's
// per-frame progress (searching → reading <doc>) never renders — the visitor sees only
// "thinking" from start to finish, until the answer pops out.
//
// This handler passes the backend response's body (ReadableStream) straight through to
// the browser, frame by frame with no buffering, so the throbber shows "reading <doc>"
// live as designed while the model is still digesting.
//
// Only this one SSE endpoint (/agent/turn) is intercepted; the rest of /api/* still
// goes through rewrites().

import { serverLog } from '@/lib/server-log';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://backend:8000';

export const dynamic = 'force-dynamic';

// hop / hopFailed — this hop logs its own record (F-O-3). Before this, it logged
// nothing: on an intermittent cross-origin failure, the backend log had no entry (the
// request never reached the backend), and the app side had none either — only a
// misleading CORS error in the browser console. Logging origin too matters because
// cross-origin and same-origin run the same code path, and origin is the first thing
// to distinguish when something breaks.
function hopFields(
  method: string, req: Request, status: number, startedAt: number,
): Record<string, unknown> {
  return {
    hop: 'app→backend', method, path: '/api/v1/agent/turn',
    origin: req.headers.get('origin') ?? '(same-origin)',
    status, dur_ms: Date.now() - startedAt,
  };
}

function hop(method: string, req: Request, status: number, startedAt: number): void {
  serverLog('info', 'proxy turn', hopFields(method, req, status, startedAt));
}

function hopFailed(method: string, req: Request, startedAt: number, err: unknown): void {
  serverLog('error', 'proxy turn failed', {
    ...hopFields(method, req, 502, startedAt), err: errText(err),
  });
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : JSON.stringify(err);
}

// corsHeadersFromBackend — a failure response still needs CORS headers attached.
//
// **Without them, every failure of this hop looks like "CORS misconfigured" to the
// browser** — that's the exact message seen on the F-O-3 incident, and it points people
// at a spot that was never broken (the backend's curl responses always carry
// `access-control-allow-origin` in every shape). The policy still lives in only one
// place, `middleware/cors.go`: this asks the backend live for a preflight answer and
// copies it back — it's copying the answer, not duplicating the rule (if it can't get
// an answer, it gives up gracefully; that's all that can be done).
async function corsHeadersFromBackend(req: Request): Promise<Headers> {
  const h = new Headers();
  try {
    const pre = await fetch(`${BACKEND}/api/v1/agent/turn`, {
      method: 'OPTIONS', headers: req.headers,
    });
    pre.headers.forEach((v, k) => {
      k.toLowerCase().startsWith('access-control-') && h.set(k, v);
    });
  } catch {
    // The backend can't even answer preflight here — and **the most common reason
    // this hop fails is that the backend is unreachable**, meaning the one time we
    // most need the headers is exactly when asking for them fails (measured
    // 2026-08-21: a curl'd 502 came back with zero access-control-* headers, so the
    // browser swallows the whole response and the console shows only
    // "No 'Access-Control-Allow-Origin'" — **the exact misleading message from the
    // original F-O-3 incident, verbatim**).
  }
  return withOriginFallback(h, req);
}

// withOriginFallback — when the policy can't be fetched, at least let the browser
// **see the actual error**.
//
// It echoes the request's own Origin, and only on **failure responses**: the body is
// just "the instance did not answer", no data. The cost of not doing this: every
// upstream outage looks to the visitor like "this site's CORS is misconfigured".
// When the backend is alive its answer is still copied verbatim — the policy lives
// in one place; this only relays the answer, never duplicates the rule.
function withOriginFallback(h: Headers, req: Request): Headers {
  const origin = fallbackOrigin(h, req);
  origin !== '' && h.set('access-control-allow-origin', origin);
  origin !== '' && h.set('vary', 'Origin');
  return h;
}

// fallbackOrigin — who to answer with. If the backend already supplied a policy,
// copy that instead (empty string = leave it untouched).
function fallbackOrigin(h: Headers, req: Request): string {
  return h.has('access-control-allow-origin') ? '' : req.headers.get('origin') ?? '';
}

// preflightFallback — when the backend can't answer preflight, this hop allows it
// through itself. It echoes back the two things the browser asked about (method /
// headers) verbatim — only then will the browser actually send the real request,
// which gets back a 502 with headers plus a human-readable message. This is the other
// half of the same idea as withOriginFallback:
// **the moment upstream dies is exactly the moment the error must not be allowed to
// masquerade as a CORS misconfiguration.**
function preflightFallback(req: Request): Headers {
  const h = new Headers({
    'access-control-allow-methods': req.headers.get('access-control-request-method') ?? 'POST',
    'access-control-allow-headers':
      req.headers.get('access-control-request-headers') ?? 'authorization,content-type',
    'access-control-max-age': '60',
  });
  return withOriginFallback(h, req);
}

// OPTIONS — a cross-origin embed sends preflight first. **This hop must answer it
// itself**: taking over this endpoint means taking over its preflight too; otherwise
// the browser stalls on "preflight failed", the POST never gets sent, and the backend
// log shows nothing — not even an OPTIONS entry. (Hit this the first time the SDK
// switched to this path and fetched a turn cross-origin — see F-O-2 item ⑤.)
//
// The policy is not duplicated here: it's **forwarded to the backend**, and its answer
// is relayed verbatim. CORS rules live in exactly one place,
// `internal/infra/middleware/cors.go` — this hop only relays.
export async function OPTIONS(req: Request): Promise<Response> {
  const startedAt = Date.now();
  try {
    const upstream = await fetch(`${BACKEND}/api/v1/agent/turn`, {
      method: 'OPTIONS', headers: req.headers,
    });
    hop('OPTIONS', req, upstream.status, startedAt);
    return new Response(null, { status: upstream.status, headers: upstream.headers });
  } catch (e) {
    // Preflight dying here means the browser never even sends the POST. This used to
    // fail silently with a 500, with no log on either side.
    hopFailed('OPTIONS', req, startedAt, e);
    // **Let preflight through** (only reached when the backend is unreachable): not
    // doing so leaves the browser saying only "No 'Access-Control-Allow-Origin'",
    // pointing people at a spot that was never broken — letting it through instead
    // means the following POST comes back as a 502 with headers plus a human-readable
    // message, so the visitor reads about **what actually happened**.
    // All downstream can get from here is that error envelope (the backend is down;
    // nothing else is possible).
    return new Response(null, { status: 204, headers: preflightFallback(req) });
  }
}

export async function POST(req: Request): Promise<Response> {
  const startedAt = Date.now();
  try {
    const upstream = await fetch(`${BACKEND}/api/v1/agent/turn`, {
      method: 'POST',
      headers: req.headers,
      body: req.body,
      // @ts-expect-error -- duplex required for streaming body; lib.dom types don't have it yet
      duplex: 'half',
    });
    hop('POST', req, upstream.status, startedAt);
    // Pass the upstream headers through as-is (text/event-stream + X-Accel-Buffering:no
    // + Cache-Control) along with the body stream. new Response(ReadableStream) flushes
    // downstream chunk by chunk, with no buffering.
    return new Response(upstream.body, {
      status: upstream.status,
      headers: upstream.headers,
    });
  } catch (e) {
    hopFailed('POST', req, startedAt, e);
    const headers = await corsHeadersFromBackend(req);
    headers.set('content-type', 'application/json');
    return new Response(
      JSON.stringify({ code: 'upstream_unreachable', message: 'the instance did not answer' }),
      { status: 502, headers },
    );
  }
}
