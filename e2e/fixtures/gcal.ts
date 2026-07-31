// gcal.ts —— Google Calendar connector + booking-policy helpers.
//
// API surface used by the gcal-booking specs. Backend implementations
// land in tasks 25-28; until then specs that call these get expected
// 404/500 errors.
//
// Also exposes /__mock/gcal/{set_busy,reset,events} on the external-mock
// so specs can seed FreeBusy fixtures and inspect what Events.insert
// the backend made.

import type { APIRequestContext } from '@playwright/test';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const MOCK = process.env['MOCK_BASE_URL'] ?? 'http://localhost:9000';

export interface GCalCredentials {
  client_id: string;
  client_secret: string;
}

export const MOCK_GCAL_CREDS: GCalCredentials = {
  client_id: 'mock-gcal-client-id',
  client_secret: 'mock-gcal-client-secret',
};

// ─── admin REST: credentials + connection lifecycle ─────────────

export async function saveGCalCredentials(
  request: APIRequestContext, csrf: string, creds: GCalCredentials,
): Promise<void> {
  const res = await request.post(
    `${BACKEND}/api/admin/connectors/google-calendar/credentials`,
    { data: creds, headers: { 'X-Csrftoken': csrf } },
  );
  if (res.status() !== 200) {
    throw new Error(`save gcal credentials: ${res.status()}`);
  }
}

export interface GCalStatus {
  has_credentials: boolean;
  connected: boolean;
  calendar_id?: string;
  scopes?: string[];
}

export async function getGCalStatus(request: APIRequestContext): Promise<GCalStatus> {
  const res = await request.get(`${BACKEND}/api/admin/connectors/google-calendar/status`);
  if (res.status() !== 200) {
    throw new Error(`gcal status: ${res.status()}`);
  }
  return await res.json() as GCalStatus;
}

export interface OAuthInitResult {
  auth_url: string;
  state: string;
}

export async function initGCalOAuth(
  request: APIRequestContext, csrf: string,
): Promise<OAuthInitResult> {
  const res = await request.post(
    `${BACKEND}/api/admin/connectors/google-calendar/connect`,
    { headers: { 'X-Csrftoken': csrf } },
  );
  if (res.status() !== 200) throw new Error(`gcal connect: ${res.status()}`);
  return await res.json() as OAuthInitResult;
}

// activateGCal —— 占用 calendar 品类槽（§9：booking 解析的是 active 连接器）。
export async function activateGCal(
  request: APIRequestContext, csrf: string,
): Promise<void> {
  const res = await request.post(
    `${BACKEND}/api/admin/connectors/google-calendar/activate`,
    { headers: { 'X-Csrftoken': csrf } },
  );
  if (res.status() !== 200) throw new Error(`gcal activate: ${res.status()}`);
}

export async function disconnectGCal(
  request: APIRequestContext, csrf: string,
): Promise<void> {
  const res = await request.post(
    `${BACKEND}/api/admin/connectors/google-calendar/disconnect`,
    { headers: { 'X-Csrftoken': csrf } },
  );
  if (res.status() !== 200) throw new Error(`gcal disconnect: ${res.status()}`);
}

// ─── admin REST: booking policy ─────────────────────────────────

export interface BookingPolicy {
  min_lead_days: number;
  allowed_weekdays: readonly ('mon'|'tue'|'wed'|'thu'|'fri'|'sat'|'sun')[];
  working_hours_start: string;  // 'HH:MM'
  working_hours_end: string;
  buffer_min: number;
  timezone: string;
}

// 预约策略是 booker 这个能力**自己声明**的配置（manifest 的 Config），面板经通用的
// capability-config 口读写 —— 后端没有 /booking-policy 这种按能力名写死的路由了。
// timezone 不在其中：那是 owner 的档案（换个能力也会用它解释"几点"），走 account。
const BOOKER = 'calendar.book';

interface ConfigField { key: string; value: unknown }

export async function getBookingPolicy(
  request: APIRequestContext,
): Promise<BookingPolicy> {
  const res = await request.get(
    `${BACKEND}/api/admin/capabilities/${BOOKER}/config`);
  if (res.status() !== 200) throw new Error(`policy get: ${res.status()}`);
  const body = await res.json() as { fields: ConfigField[] };
  const out: Record<string, unknown> = {};
  for (const f of body.fields) out[f.key] = f.value;
  const me = await request.get(`${BACKEND}/api/admin/me`);
  const owner = (await me.json() as { owner: { timezone: string } }).owner;
  return { ...out, timezone: owner.timezone } as unknown as BookingPolicy;
}

export async function setBookingPolicy(
  request: APIRequestContext, csrf: string, patch: Partial<BookingPolicy>,
): Promise<void> {
  const status = await patchBookingPolicyStatus(request, csrf, patch);
  if (status !== 200) throw new Error(`policy set: ${status}`);
}

// patchBookingPolicyStatus —— PATCH 并返回 HTTP 状态码(不断言成功)。给
// 校验类测试用(e.g. min_lead_days 非正整数 → 期望 400)。
export async function patchBookingPolicyStatus(
  request: APIRequestContext, csrf: string, patch: Partial<BookingPolicy>,
): Promise<number> {
  const { timezone, ...fields } = patch as Record<string, unknown>;
  if (timezone !== undefined) {
    const tzRes = await request.patch(`${BACKEND}/api/admin/account/timezone`,
      { data: { timezone }, headers: { 'X-Csrftoken': csrf } });
    if (tzRes.status() !== 200) return tzRes.status();
  }
  if (Object.keys(fields).length === 0) return 200;
  const res = await request.patch(
    `${BACKEND}/api/admin/capabilities/${BOOKER}/config`,
    { data: { values: fields }, headers: { 'X-Csrftoken': csrf } },
  );
  return res.status();
}

// ─── mock control: FreeBusy fixture + Events inspection ─────────

/** A single busy window served by the mock FreeBusy endpoint. */
export interface BusyWindow {
  start: string;  // RFC3339
  end: string;    // RFC3339
}

/** Seed FreeBusy fixture for the current test. */
export async function setMockBusy(
  request: APIRequestContext, busy: readonly BusyWindow[],
): Promise<void> {
  const res = await request.post(`${MOCK}/__mock/gcal/set_busy`, { data: { busy } });
  if (res.status() !== 200) throw new Error(`mock set_busy: ${res.status()}`);
}

/** Make the mock OAuth token endpoint reject the next refresh with
 *  invalid_grant — simulates the owner revoking calendar access at Google.
 *  The backend should map this to a revoked connector and degrade
 *  gracefully (Phase B: friendly error, not a crash). */
export async function revokeMockGCalToken(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${MOCK}/__mock/gcal/revoke`);
  if (res.status() !== 200) throw new Error(`mock gcal revoke: ${res.status()}`);
}

/** Reset all GCal mock state (busy fixture + recorded events). */
export async function resetMockGCal(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${MOCK}/__mock/gcal/reset`);
  if (res.status() !== 200) throw new Error(`mock reset: ${res.status()}`);
}

/** A record of what the backend POSTed to mock Events.insert. */
export interface MockEvent {
  event_id: string;
  summary: string;
  description?: string;
  start: { dateTime: string };
  end: { dateTime: string };
  attendees?: { email: string }[];
  send_updates?: string;
}

export async function getMockEvents(
  request: APIRequestContext,
): Promise<MockEvent[]> {
  const res = await request.get(`${MOCK}/__mock/gcal/events`);
  if (res.status() !== 200) throw new Error(`mock events: ${res.status()}`);
  const body = await res.json() as { events: MockEvent[] };
  return body.events;
}
