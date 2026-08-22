// caldav-mock.ts —— 驱 CalDAV 替身的忙时（`mock-stack/job-board/caldav.go`）。
//
// 忙时有**两种真实答法**，产品都得认（F-C-50）：
//   FREEBUSY[;params]:<start>/<end>      属性形式（Google / Fastmail 一族）
//   VFREEBUSY 组件上的 DTSTART / DTEND   组件形式（Radicale 一族，一段一个组件）
// 替身以前只会前一种，所以「产品读不懂忙时」这件事在测试里永远发生不了 ——
// 真环境上它的样子是：日历上有一场每周一的会，产品对访客说「这天连着一整天没有空档」。

import type { APIRequestContext } from '@playwright/test';

/** busyStyleComponent —— Radicale 那种答法：一段一个 VFREEBUSY，时间写在 DTSTART / DTEND 上。 */
export const busyStyleComponent = 'component';

/** busyStyleProperty —— 已经支持的那种：一行 `FREEBUSY:<start>/<end>`。 */
export const busyStyleProperty = 'property';

// ical —— `2026-08-31T14:00:00.000Z` → `20260831T140000Z`。
//
// 测试里的时间一路是 `toISOString()`，而 CalDAV 用的是这一种；直接把 RFC3339 塞给替身的话，
// 产品在**格式**上就读不出来，于是任何关于**形状**的守卫都会红在一个无关的地方
// （[[red-in-the-wrong-place]]）。
function ical(iso: string): string {
  return iso.replace(/[-:]/gu, '').replace(/\.\d{3}/u, '');
}

/** CalDAVEvent —— 替身录到的一个会（字段跟 gcal 那侧归一）。 */
export interface CalDAVEvent {
  summary: string;
  start: string;
  end: string;
  attendees?: string[];
}

/** getCalDAVEvents —— CalDAV 的会落在替身的 collection 里（不是 gcal store），单独读它。 */
export async function getCalDAVEvents(
  request: APIRequestContext, mockBase: string, coll: string,
): Promise<CalDAVEvent[]> {
  const res = await request.get(`${mockBase}/__mock/caldav/${coll}/events`);
  if (res.status() !== 200) throw new Error(`caldav events: ${res.status()}`);
  return (await res.json() as { events: CalDAVEvent[] }).events;
}

/** resetCalDAV —— 清一个 collection 的会 / 忙时 / 失败注入。 */
export async function resetCalDAV(
  request: APIRequestContext, mockBase: string, coll: string,
): Promise<void> {
  await request.post(`${mockBase}/__mock/caldav/${coll}/reset`, { data: {} })
    .catch(() => undefined);
}

/** setCalDAVBusy —— 把某 collection 的忙时设成 [start, start+30min)，并指定回包形状。 */
export async function setCalDAVBusy(
  request: APIRequestContext, mockBase: string, coll: string, start: string, style: string,
): Promise<void> {
  const end = new Date(new Date(start).getTime() + 30 * 60_000).toISOString();
  const res = await request.post(`${mockBase}/__mock/caldav/${coll}/set_busy`, {
    data: { busy: [{ start: ical(start), end: ical(end) }], style },
  });
  if (res.status() !== 200) throw new Error(`set_busy: ${res.status()}`);
}
