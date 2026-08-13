// format-time —— 这个产品**只有**这三种时间写法，全部住在这里。
//
// 为什么这个模块存在（UX-46）：owner 一次会话经过的三个面上出现了三种写法 ——
// transcript 模态 `8/8/2026, 10:16:07 AM`（美式 locale + 秒 + AM/PM）、dashboard 的
// 「最近来访」`2026-08-07T01:09:14Z`（ISO + Z，那是给机器看的）、同页标题 `last refresh · now`
// （相对）。这是 [[vocabulary-must-not-diverge]] 的视觉版：一个概念一种写法。
//
// 成因跟 UX-47（下拉五种写法）/ UX-59（输入框两种长相）一样 —— **没有这一层**，
// 于是每个面各自 `toISOString().slice(0,10)` / `toLocaleString()`（前者被复制了四份）。
//
// 三种写法，按**读者要拿它做什么**分：
//   - `ago()`     —— 列表和卡片里的"多久以前"。扫的时候要的是新鲜度，不是坐标。
//                    精确值放进 title，鼠标停下来就能看到。
//   - `stampMinute()` —— 转录、引用、要被贴进别处的场合。分钟够，秒不够用还添乱。
//   - `stampDay()`    —— 只关心哪一天的行（创建于、更新于）。
//
// 全部按**本地时区**渲染：读它的是 owner，不是机器。`toISOString()` 是 UTC，
// 在东八区会把当地的凌晨算成前一天 —— 那是原来那四份复制品共同带的 bug。
//
// 坏输入原样返回：一个显示函数不该把 owner 的数据吞掉（[[display-fallback-reintroduces-the-bug]]
// 说的是反面 —— 这里返回原串是让坏数据**可见**，不是拿它冒充好数据）。

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const RELATIVE_HORIZON = 7 * DAY;

function parse(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** stampDay —— `2026-08-08`。本地时区的那一天。 */
export function stampDay(iso: string): string {
  const d = parse(iso);
  return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : iso;
}

/** stampMinute —— `2026-08-08 10:16`。要被引用/贴走的场合用这个。 */
export function stampMinute(iso: string): string {
  const d = parse(iso);
  return d ? `${stampDay(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}` : iso;
}

/**
 * ago —— `just now` / `12m ago` / `3h ago` / `2d ago`，超过一周退回 `stampDay`。
 * `now` 只为可测性存在；调用点不传。
 */
export function ago(iso: string, now: number = Date.now()): string {
  const d = parse(iso);
  if (!d) return iso;
  const delta = now - d.getTime();
  if (delta < 0) return stampMinute(iso);          // 未来时间：相对说法读不通
  if (delta < MINUTE) return 'just now';
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  if (delta < RELATIVE_HORIZON) return `${Math.floor(delta / DAY)}d ago`;
  return stampDay(iso);
}
