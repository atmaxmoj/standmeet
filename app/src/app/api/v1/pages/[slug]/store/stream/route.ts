// Streaming pass-through for GET /api/v1/pages/{slug}/store/stream — an open page hears when its
// store changes (a shared manuscript: another visitor's passage, the owner's approval or delete).
//
// Same reason as /api/v1/live/[token]/stream: next.config's rewrites() buffer an SSE body until it
// ends, and this stream never ends while the page is open. The request's headers go along: the
// backend applies the page's access rule from the visitor's token or the owner's cookie.

const BACKEND = process.env['BACKEND_URL'] ?? 'http://backend:8000';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await ctx.params;
  try {
    const upstream = await fetch(`${BACKEND}/api/v1/pages/${encodeURIComponent(slug)}/store/stream`, {
      headers: req.headers, signal: req.signal,
    });
    return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
  } catch {
    return new Response(JSON.stringify({ code: 'upstream_unreachable', message: 'the instance did not answer' }),
      { status: 502, headers: { 'content-type': 'application/json' } });
  }
}
