// caldav-mock.ts —— drives the CalDAV mock's busy times (`mock-stack/job-board/caldav.go`).
//
// Busy time has **two real-world encodings**, both of which the product must
// accept (F-C-50):
//   FREEBUSY[;params]:<start>/<end>      the property form (Google / Fastmail family)
//   DTSTART / DTEND on a VFREEBUSY component   the component form (Radicale family,
//                                              one component per interval)
// The mock used to only speak the first, so "the product can't read busy time"
// could never happen in a test —— in a real environment it looks like this: the
// calendar has a weekly Monday meeting, and the product tells the visitor "this
// day has no free slot at all".

import type { APIRequestContext } from '@playwright/test';

/** busyStyleComponent —— the Radicale-style answer: one VFREEBUSY per interval,
 *  with the time written on DTSTART / DTEND. */
export const busyStyleComponent = 'component';

/** busyStyleProperty —— the already-supported one: a single line `FREEBUSY:<start>/<end>`. */
export const busyStyleProperty = 'property';

// ical —— `2026-08-31T14:00:00.000Z` → `20260831T140000Z`。
//
// Times in tests are always `toISOString()`, whereas CalDAV uses this form; if
// you hand RFC3339 straight to the mock, the product can't read it at the
// **format** level, so any guard about **shape** turns red in an unrelated place
// ([[red-in-the-wrong-place]]).
function ical(iso: string): string {
  return iso.replace(/[-:]/gu, '').replace(/\.\d{3}/u, '');
}

/** CalDAVEvent —— one event recorded by the mock (fields normalized to match the gcal side). */
export interface CalDAVEvent {
  summary: string;
  start: string;
  end: string;
  attendees?: string[];
}

/** getCalDAVEvents —— CalDAV events land in the mock's collection (not the gcal
 *  store), so read them separately. */
export async function getCalDAVEvents(
  request: APIRequestContext, mockBase: string, coll: string,
): Promise<CalDAVEvent[]> {
  const res = await request.get(`${mockBase}/__mock/caldav/${coll}/events`);
  if (res.status() !== 200) throw new Error(`caldav events: ${res.status()}`);
  return (await res.json() as { events: CalDAVEvent[] }).events;
}

/** resetCalDAV —— clear a collection's events / busy times / fault injection. */
export async function resetCalDAV(
  request: APIRequestContext, mockBase: string, coll: string,
): Promise<void> {
  await request.post(`${mockBase}/__mock/caldav/${coll}/reset`, { data: {} })
    .catch(() => undefined);
}

/** setCalDAVBusy —— set a collection's busy time to [start, start+30min), and
 *  specify the response encoding. */
export async function setCalDAVBusy(
  request: APIRequestContext, mockBase: string, coll: string, start: string, style: string,
): Promise<void> {
  const end = new Date(new Date(start).getTime() + 30 * 60_000).toISOString();
  const res = await request.post(`${mockBase}/__mock/caldav/${coll}/set_busy`, {
    data: { busy: [{ start: ical(start), end: ical(end) }], style },
  });
  if (res.status() !== 200) throw new Error(`set_busy: ${res.status()}`);
}
