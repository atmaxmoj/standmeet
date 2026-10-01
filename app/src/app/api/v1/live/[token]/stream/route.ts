// Streaming pass-through for GET /api/v1/live/{token}/stream — the owner's live transcript.
//
// Same reason as /api/v1/agent/turn/route.ts: next.config's rewrites() buffer an SSE body until it
// ends, and this stream never ends while the owner watches, so the page would see nothing at all.
// Same-origin only (the live page is on the app), so no CORS handling.

const BACKEND = process.env['BACKEND_URL'] ?? 'http://backend:8000';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await ctx.params;
  try {
    const upstream = await fetch(`${BACKEND}/api/v1/live/${encodeURIComponent(token)}/stream`, {
      signal: req.signal,
    });
    return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
  } catch {
    return new Response(JSON.stringify({ code: 'upstream_unreachable', message: 'the instance did not answer' }),
      { status: 502, headers: { 'content-type': 'application/json' } });
  }
}
