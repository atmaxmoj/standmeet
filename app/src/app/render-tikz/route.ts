// /render-tikz -- TikZ source -> SVG. Lives outside /api (Next rewrites only proxy
// /api/* to the backend); this route is handled by Next itself (Node runtime,
// node-tikzjax uses a WASM TeX engine). Render logic lives in the usecase
// (@/lib/render/tikz); the controller only parses the body + passes through the result.

import { NextResponse } from 'next/server';

import { renderTikz } from '@/lib/render/tikz';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<NextResponse> {
  const result = await renderTikz(await bodyOrNull(req));
  return NextResponse.json(result.payload, { status: result.status });
}

function bodyOrNull(req: Request): Promise<unknown> {
  return req.json().catch(() => null);
}
