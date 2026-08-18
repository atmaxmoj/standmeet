// server-log —— 在 **app 进程自己**（route handler / server component）里记事的出口。
//
// 为什么不复用 `@/lib/logger`：那个是**浏览器**那一侧的出口，prod 默认哑（要显式开
// NEXT_PUBLIC_CLIENT_LOG）。装在服务端就必须一直发声 —— 它记的是「这一跳发生了什么」，
// 而容器日志是唯一读得到它的地方。
//
// 为什么需要它（F-O-3）：`/api/v1/agent/turn` 这一跳是 app 自己手写的反代。跨源第一轮偶发
// 整个失败时，**后端日志里什么都没有**（请求根本没到后端），app 这边也什么都没有 ——
// 于是唯一的线索是浏览器控制台里一句会误导人的 CORS 报错。没有装置，就只能靠推理，
// 而需要推理本身就是缺陷（[[no-diagnosis-by-experiment]]）。
//
// 形状跟后端的 slog 对齐（JSON 一行一条），让两边的日志能拼在同一条时间线上读。

/* eslint-disable no-console */

export function serverLog(
  level: 'info' | 'warn' | 'error', msg: string, fields: Record<string, unknown>,
): void {
  const line = JSON.stringify({ level, msg, at: new Date().toISOString(), ...fields });
  level === 'error' ? console.error(line) : console.log(line);
}
