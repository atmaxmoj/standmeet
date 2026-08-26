// app-health —— **这个 app 自己**还活着吗。不碰后端。
//
// 为什么要单独有一条：容器的健康检查原来打的是 `/api/v1/instance`，而那条在 `afterFiles`
// 里被反代到 backend —— 于是它量的是**两跳**（app → backend），timeout 只有 3 秒。
// 后端一慢（这台机器上实测过 6.8 秒），一个完全健康的 app 就被判成 unhealthy：
// compose 的 `--wait` 失败、编排器重启一个没坏的组件、而每一条 e2e 的 `ensureStackUp`
// 跟着一起红。健康检查在测它的依赖，不是测它自己。
//
// 依赖健不健康由**依赖自己的**健康检查回答（backend 有 `/internal/healthz`，db/redis 各有各的）。
// 一个组件替另一个组件报告健康，坏消息会传染，而好消息传不回去。
//
// 放在 `/api/` 下面而不是根路径：根上有 `[handle]` 那条动态路由（owner 的公开页），
// 多一条静态段是给它添歧义。app 自己的 route handler 排在 `afterFiles` 反代之前，
// 所以这条不会被转给后端；哪天这个文件没了，请求会落到后端并 404，`wget` 非零退出 ——
// 静默失效不了。

import { NextResponse } from 'next/server';

export function GET(): NextResponse {
  return NextResponse.json({ ok: true, service: 'app' });
}
