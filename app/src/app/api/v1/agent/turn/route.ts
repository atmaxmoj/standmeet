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

import { serverLog } from '@/lib/server-log';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://backend:8000';

export const dynamic = 'force-dynamic';

// hop / hopFailed —— 这一跳自己记一条（F-O-3）。以前它什么都不记：跨源第一轮偶发失败时，
// 后端日志里没有（请求没到后端），app 这边也没有，只剩浏览器控制台一句会误导人的 CORS 报错。
// origin 一起记 —— 跨源和同源走的是同一段代码，出事时第一个要分清的就是这个。
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

// corsHeadersFromBackend —— 失败也要带着 CORS 头回去。
//
// **不带的话，这一跳的每一次失败在浏览器眼里都是「CORS 没配好」** —— 那正是 F-O-3 现场看到
// 的那句话，它把人指向一个根本没坏的地方（后端 curl 每种形状都带 `access-control-allow-origin`）。
// 策略仍然只有 `middleware/cors.go` 一处：这里现问后端要一次 preflight 的答复，抄回来的是
// 答案不是规则（问不到就算了，能做的都做了）。
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
    // 后端连 preflight 都答不了 —— 头就没有了，下面那个 502 至少是个诚实的状态码。
  }
  return h;
}

// OPTIONS —— 跨源的 embed 先发 preflight。**这一跳必须自己答**：接管了这个端点，就连它的
// preflight 一起接管了；不答的话浏览器停在「preflight 没通过」上，POST 根本不会发出去，而
// 后端日志里只看得到一条 OPTIONS 也没有 —— SDK 切到这条路之后第一次跨源取 turn 就死在这儿
// （F-O-2 的 ⑤ 里撞到的）。
//
// 策略不在这儿抄第二份：**转给后端**，把它的答复原样带回来。CORS 规则只有
// `internal/infra/middleware/cors.go` 一处，这一跳只负责搬。
export async function OPTIONS(req: Request): Promise<Response> {
  const startedAt = Date.now();
  try {
    const upstream = await fetch(`${BACKEND}/api/v1/agent/turn`, {
      method: 'OPTIONS', headers: req.headers,
    });
    hop('OPTIONS', req, upstream.status, startedAt);
    return new Response(null, { status: upstream.status, headers: upstream.headers });
  } catch (e) {
    // preflight 在这一跳挂掉 = 浏览器连 POST 都不会发。以前这里静默 500，两侧日志皆空。
    hopFailed('OPTIONS', req, startedAt, e);
    return new Response(null, { status: 502 });
  }
}

export async function POST(req: Request): Promise<Response> {
  const startedAt = Date.now();
  try {
    const upstream = await fetch(`${BACKEND}/api/v1/agent/turn`, {
      method: 'POST',
      headers: req.headers,
      body: req.body,
      // @ts-expect-error -- duplex 是流式请求体必需项,lib.dom 类型还没补上
      duplex: 'half',
    });
    hop('POST', req, upstream.status, startedAt);
    // 透传上游 headers(text/event-stream + X-Accel-Buffering:no + Cache-Control)
    // 和 body 流。new Response(ReadableStream) 是逐块往下游冲,不 buffer。
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
