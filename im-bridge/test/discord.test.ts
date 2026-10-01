// discord.test.ts —— the owner connects Discord with one field, the bot token, and nothing else.
//
// The Chat SDK's Discord adapter also demands an application id, a public key, and a bot whose
// Message Content intent is on. The public key only verifies HTTP interactions, and the bridge
// never takes any (it listens on the Gateway, an outbound connection — a self-hosted instance has
// no public callback URL). The rest the bridge asks Discord for with the token itself, so the owner
// never opens the developer portal for it ("你最好让这种部署依赖少点，都在ui里面写", 2026-10-01).

import { afterEach, describe, expect, it, vi } from 'vitest';

import { MESSAGE_CONTENT_LIMITED, prepareDiscord, rejectHTTPInteractions } from '../src/discord.js';

afterEach(() => { vi.unstubAllGlobals(); });

type Call = { url: string; method: string; body: unknown };

function discordAPI(app: { ok: boolean; flags?: number }, patchOk = true) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
    const ok = method === 'GET' ? app.ok : patchOk;
    return Promise.resolve({
      ok, status: ok ? 200 : 401,
      json: () => Promise.resolve({ id: '1010101010101010101', flags: app.flags ?? 0 }),
    } as Response);
  }));
  return calls;
}

describe('discord 只要一个 token', () => {
  it('Discord 认这个 token → 起 Discord', async () => {
    discordAPI({ ok: true, flags: MESSAGE_CONTENT_LIMITED });
    expect(await prepareDiscord('a.b.c', () => undefined)).toBeDefined();
  });

  it('Discord 不认 → 跳过 Discord、说一句人话，不把整座桥拖垮', async () => {
    // 2026-10-01 on sijie: the card held something that was not a bot token; the adapter threw
    // "applicationId is required" at startup and the bridge crash-looped, Telegram with it.
    discordAPI({ ok: false });
    const logs: string[] = [];
    expect(await prepareDiscord('not-a-token', (m) => logs.push(m))).toBeUndefined();
    expect(logs.join('\n')).toMatch(/admin\/suppliers/);
  });

  it('Message Content intent 没开 → 桥自己打开，owner 不用去开发者后台', async () => {
    const calls = discordAPI({ ok: true, flags: 1 << 23 });
    await prepareDiscord('a.b.c', () => undefined);
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.url).toMatch(/applications\/@me$/);
    expect(patch?.body).toEqual({ flags: (1 << 23) | MESSAGE_CONTENT_LIMITED });
  });

  it('已经开了就不再改', async () => {
    const calls = discordAPI({ ok: true, flags: MESSAGE_CONTENT_LIMITED });
    await prepareDiscord('a.b.c', () => undefined);
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('打开失败（比如 bot 已进 100 个服务器要审核）→ 说清楚去哪开，照样起 Discord', async () => {
    discordAPI({ ok: true, flags: 0 }, false);
    const logs: string[] = [];
    expect(await prepareDiscord('a.b.c', (m) => logs.push(m))).toBeDefined();
    expect(logs.join('\n')).toMatch(/Message Content/);
  });

  it('HTTP interactions 一律拒收：这个桥只走 Gateway', async () => {
    expect(await rejectHTTPInteractions()).toBe(false);
  });
});
