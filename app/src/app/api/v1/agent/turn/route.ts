// /api/v1/agent/turn 流式反代 Route Handler。
//
// 为什么不走 next.config 的 rewrites():那套代理会 buffer 上游 SSE —— 实测后端
// 每帧都 Flush(tool_started/…早早出),但浏览器要等整条 turn 结束才一次性收到
// 全部帧。结果 throbber 的逐帧进度(searching → reading <doc>)根本画不出来,
// visitor 从头到尾只看到 "thinking" 直到答案蹦出来。
//
// 这个 handler 直接把 backend response 的 body(ReadableStream)透传给浏览器,
// 逐帧流式不 buffer,throbber 才如设计般实时显「reading <doc>」撑过模型消化那段。
//
// 只接管 /agent/turn 这一个 SSE 端点;其余 /api/* 仍走 rewrites()。

const BACKEND = process.env['BACKEND_URL'] ?? 'http://backend:8000';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const upstream = await fetch(`${BACKEND}/api/v1/agent/turn`, {
    method: 'POST',
    headers: req.headers,
    body: req.body,
    // @ts-expect-error -- duplex 是流式请求体必需项,lib.dom 类型还没补上
    duplex: 'half',
  });
  // 透传上游 headers(text/event-stream + X-Accel-Buffering:no + Cache-Control)
  // 和 body 流。new Response(ReadableStream) 是逐块往下游冲,不 buffer。
  return new Response(upstream.body, {
    status: upstream.status,
    headers: upstream.headers,
  });
}
