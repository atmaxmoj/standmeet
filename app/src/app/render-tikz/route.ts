// /render-tikz —— TikZ 源码 → SVG。放非 /api 路径(Next rewrites 只反代 /api/* 到后端),
// 这条 Next 自己处理(Node runtime,node-tikzjax 用 WASM TeX 引擎)。渲染逻辑在 usecase
// (@/lib/render/tikz);controller 只解 body + 透传结果。

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
