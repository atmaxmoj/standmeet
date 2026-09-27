// webhooks.ts —— the webhook-sink mock (mock-stack/job-board/webhook_sink.go), Standard Webhooks
// signature verification, and endpoint setup through the owner MCP face, for the webhook specs.
//
// The backend reaches the sink at http://external-mock:9000/webhook-sink/<name> (inside the compose
// network); the suite reads what arrived at MOCK_BASE/__mock/webhook-sink/<name>/received.

import { createHmac, timingSafeEqual } from 'node:crypto';

import { expect, type APIRequestContext } from '@playwright/test';

import { callTool, callToolOutcome, type ToolOutcome } from '@/fixtures/mcp';
import { BACKEND, MOCK_BASE } from '@/fixtures/stack';

/** The address the BACKEND posts to (compose-internal name). */
export function sinkURL(name: string): string {
  return `http://external-mock:9000/webhook-sink/${name}`;
}

export interface SinkDelivery {
  headers: Record<string, string>;
  body: { id: string; type: string; subject: string; occurred_at: string; data: Record<string, unknown> };
  raw: string;
  at: string;
  status: number;
}

export async function received(request: APIRequestContext, name: string): Promise<SinkDelivery[]> {
  const res = await request.get(`${MOCK_BASE}/__mock/webhook-sink/${name}/received`);
  return await res.json() as SinkDelivery[];
}

/** Arms the sink (a mock control call, not a product write). */
export async function planSink(
  request: APIRequestContext, name: string, plan: { status: number; count: number; retry_after?: string },
): Promise<void> {
  await request.post(`${MOCK_BASE}/__mock/webhook-sink/${name}/plan`, { data: plan });
}

export async function resetSink(request: APIRequestContext): Promise<void> {
  await request.post(`${MOCK_BASE}/__mock/webhook-sink/reset`);
}

/** Polls the sink until pred holds (bounded), then returns what arrived. */
export async function awaitSink(
  request: APIRequestContext, name: string, pred: (d: SinkDelivery[]) => boolean, timeout = 60_000,
): Promise<SinkDelivery[]> {
  let got: SinkDelivery[] = [];
  await expect.poll(async () => { got = await received(request, name); return pred(got); }, { timeout, intervals: [500] }).toBe(true);
  return got;
}

/** Only the 2xx-answered deliveries (what the receiver actually accepted). */
export function accepted(ds: SinkDelivery[]): SinkDelivery[] {
  return ds.filter((d) => d.status >= 200 && d.status < 300);
}

/**
 * verifySignature —— Standard Webhooks v1: base64(HMAC-SHA256(secret, `${id}.${ts}.${rawBody}`)).
 * The secret is `whsec_<base64 key>`. The header may carry several space-separated `v1,<sig>`.
 * Computed over the raw bytes the sink received, never over a re-serialised body.
 */
export function verifySignature(d: SinkDelivery, secret: string): boolean {
  const id = d.headers['Webhook-Id'] ?? '';
  const ts = d.headers['Webhook-Timestamp'] ?? '';
  const header = d.headers['Webhook-Signature'] ?? '';
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${ts}.${d.raw}`).digest();
  return header.split(' ').some((part) => {
    const [ver, sig] = part.split(',');
    if (ver !== 'v1' || sig === undefined) return false;
    const got = Buffer.from(sig, 'base64');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

// ── endpoint setup through the owner MCP face (the same webhooks.* ops the admin page projects) ──

/** The caller's owner-MCP session: API token + MCP session id. */
export interface OwnerMCP { request: APIRequestContext; apiToken: string; sid: string }

export interface CreatedHook { endpoint: { id: string }; secret: string }

export async function createHook(o: OwnerMCP, sink: string, types: string[]): Promise<CreatedHook> {
  return callTool<CreatedHook>(o.request, o.apiToken, o.sid, 'webhooks.create', { url: sinkURL(sink), event_types: types });
}

export async function rotateHookSecret(o: OwnerMCP, id: string): Promise<string> {
  return (await callTool<{ secret: string }>(o.request, o.apiToken, o.sid, 'webhooks.rotate_secret', { id })).secret;
}

export async function setHookEnabled(o: OwnerMCP, id: string, enabled: boolean): Promise<void> {
  await callTool(o.request, o.apiToken, o.sid, 'webhooks.update', { id, enabled });
}

export interface HookDelivery {
  job_id: number; state: string; attempt: number; event_id: string;
  errors?: { error: string; attempt: number }[] | null;
}

export async function hookDeliveries(o: OwnerMCP, id: string): Promise<HookDelivery[]> {
  return (await callTool<{ deliveries: HookDelivery[] }>(o.request, o.apiToken, o.sid, 'webhooks.deliveries', { id })).deliveries;
}

/** webhooks.create as an outcome: for the refusal case, where the error text is the assertion. */
export async function tryCreateHook(o: OwnerMCP, url: string): Promise<ToolOutcome> {
  return callToolOutcome(o.request, o.apiToken, o.sid, 'webhooks.create', { url, event_types: ['corpus.note.changed'] });
}

// ── embeds carrying an update hook (embeds.* on the owner MCP face) ──

type SyncMode = 'live' | 'copy';

export interface HookedEmbed {
  id: string; key_id: string; sync_mode: SyncMode;
  update_hook?: { endpoint_id: string; url: string }; secret?: string;
}

export async function createEmbedFor(o: OwnerMCP, codeID: string, label: string): Promise<HookedEmbed> {
  return callTool<HookedEmbed>(o.request, o.apiToken, o.sid, 'embeds.create', { code_id: codeID, label });
}

/** A hook belongs to the copy mode, so attaching one says copy. */
export async function setEmbedHook(o: OwnerMCP, embedID: string, sink: string): Promise<HookedEmbed> {
  return callTool<HookedEmbed>(o.request, o.apiToken, o.sid, 'embeds.update', {
    embed_id: embedID, sync_mode: 'copy', update_hook_url: sinkURL(sink),
  });
}

export async function setEmbedLive(o: OwnerMCP, embedID: string): Promise<HookedEmbed> {
  return callTool<HookedEmbed>(o.request, o.apiToken, o.sid, 'embeds.update', { embed_id: embedID, sync_mode: 'live' });
}

/** embeds.update as an outcome: for the refusal case, where the error text is the assertion. */
export async function tryUpdateEmbed(o: OwnerMCP, args: Record<string, unknown>): Promise<ToolOutcome> {
  return callToolOutcome(o.request, o.apiToken, o.sid, 'embeds.update', args);
}

/** The public read a consuming site makes: the embed's sync mode by its (public) key id. */
export async function publicSyncMode(request: APIRequestContext, kid: string): Promise<{ status: number; mode: string }> {
  const res = await request.get(`${BACKEND}/api/v1/embeds/${kid}`);
  const body = res.status() === 200 ? await res.json() as { sync_mode?: string } : {};
  return { status: res.status(), mode: body.sync_mode ?? '' };
}

/** The endpoint ids on the instance (webhooks.list). */
export async function endpointIDs(o: OwnerMCP): Promise<string[]> {
  const out = await callTool<{ endpoints: { id: string }[] }>(o.request, o.apiToken, o.sid, 'webhooks.list', {});
  return out.endpoints.map((e) => e.id);
}
