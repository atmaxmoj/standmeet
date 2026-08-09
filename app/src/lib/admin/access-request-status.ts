// access-request-status —— 「一条 access request 还等着 owner 处理吗」的**唯一**判据。
//
// 这个词表以前在两个文件里各写了一遍,而且写得不一样:侧栏徽标数 `'open'`(对),dashboard 的
// REQUESTS 数 `'new' || 'pending'`(两个值后端从来不产出)。于是同一份数据,徽标显示 1、
// KPI 显示 0,而那个 0 恒为 0 —— 有多少条待处理都一样(F-C-19)。
//
// 后端的词表写死在 `access_request.go`:`'open' | 'replied' | 'closed'`。这里只认它。
// 收成一处不是为了少写几个字,是为了**下一次改词表时只有一个地方会漏**。

/** 后端 access_requests.status 的取值。 */
export const ACCESS_REQUEST_OPEN = 'open';

/** 还等着 owner 处理的那些（徽标和 KPI 都数这一批）。
 *
 * status 收 optional：徽标那侧的 schema 允许缺这一格。缺了就**不算**待处理 ——
 * 一条读不出状态的行,宁可少数一个,也不要让 owner 去找一条不存在的请求。 */
export function pendingRequests<T extends { status?: string }>(rows: readonly T[]): T[] {
  return rows.filter((r) => r.status === ACCESS_REQUEST_OPEN);
}
