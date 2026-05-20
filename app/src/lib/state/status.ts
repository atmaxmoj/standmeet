// status —— 所有 store 共享的 status 枚举。每个 resource store 都有
//   - idle:     还没 fetch 过（用 ensureLoaded 触发首拉）
//   - loading:  正在 fetch（首次或显式 refresh）
//   - ready:    有 data；可能同时带 error（局部失败，旧数据仍在）
//   - error:    fetch 失败且没有 cached data
//
// 之前 13 个 hook 各自发明 shape，现在所有 store 都讲这一套语言。
//
// Discriminated union for state.kind 在简单 idle/loading/error/ready 四态时
// 写得啰嗦，这里用 status flag + 可选 data + 可选 error 三字段平铺；selector
// 模式 + skeleton 模式都更顺。

export type ResourceStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ResourceShape<T> {
  status: ResourceStatus;
  data: T | undefined;
  error: string | null;
  lastFetched: number | null; // Date.now() at last successful fetch; null 未拉过
}
