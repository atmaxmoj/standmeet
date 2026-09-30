// config.test.ts —— the fact that the token is **fetched from the instance**.
//
// This group exists because of the product rule: credentials are configured in the UI,
// not in env. If the bridge secretly read an environment variable, the owner would
// have to go edit a file and restart the container — right after they just changed
// every other connector from the interface.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchIMConfig, platformsFor, waitForChange, waitForConfig } from '../src/config.js';

afterEach(() => { vi.unstubAllGlobals(); });

function respondWith(bodies: unknown[]) {
  let i = 0;
  return vi.fn(() => {
    const body = bodies[Math.min(i, bodies.length - 1)];
    i += 1;
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
  });
}

describe('bot token 从实例取', () => {
  it('后端给了 token 就用它', async () => {
    vi.stubGlobal('fetch', respondWith([{ telegram_token: 'T-1' }]));
    expect((await fetchIMConfig('http://backend:8000')).telegramToken).toBe('T-1');
  });

  it('后端没给（owner 还没配）→ 空串，不是抛错', async () => {
    // "not configured yet" is a normal state for an instance, not a failure. Treating
    // it as an error would mean any instance without IM connected has a container
    // stuck reporting errors forever, and the owner would think it's broken.
    vi.stubGlobal('fetch', respondWith([{}]));
    expect((await fetchIMConfig('http://backend:8000')).telegramToken).toBe('');
  });

  it('内部口挂了 → 抛出去，让调用方决定重试', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ ok: false, status: 503 } as Response)));
    await expect(fetchIMConfig('http://backend:8000')).rejects.toThrow(/503/);
  });

  it('**等到配好为止**：先空后有，拿到就返回', async () => {
    const fetchMock = respondWith([{ telegram_token: '' }, { telegram_token: 'T-2' }]);
    vi.stubGlobal('fetch', fetchMock);
    const logs: string[] = [];
    const cfg = await waitForConfig('http://backend:8000',
      { everyMs: 1, log: (m) => logs.push(m) });
    expect(cfg.telegramToken).toBe('T-2');
    // The "not configured yet" notice is said only once — repeating the same line
    // every 15 seconds would make the log unreadable.
    expect(logs, 'the waiting notice is said once, not on every poll').toHaveLength(1);
    // The notice must send the owner to a page that EXISTS. It said /admin/connectors,
    // which is the pre-rename name — that route is gone, so the one line the bridge ever
    // prints was pointing at a 404 ([[vocabulary-must-not-diverge]]).
    expect(logs[0]).toMatch(/admin\/suppliers/);
  });

  it('Discord 的 token 也从实例取', async () => {
    vi.stubGlobal('fetch', respondWith([{ telegram_token: '', discord_token: 'D-1' }]));
    const cfg = await fetchIMConfig('http://backend:8000');
    expect(cfg.discordToken).toBe('D-1');
    expect(cfg.telegramToken).toBe('');
  });

  it('只配了 Discord 也算配好了：等待结束，交回整份配置', async () => {
    vi.stubGlobal('fetch', respondWith([{}, { discord_token: 'D-2' }]));
    const cfg = await waitForConfig('http://backend:8000', { everyMs: 1 });
    expect(cfg).toEqual({ telegramToken: '', discordToken: 'D-2' });
  });

  it('按配置起平台：配了哪个就起哪个', () => {
    expect(platformsFor({ telegramToken: 'T', discordToken: '' })).toEqual(['telegram']);
    expect(platformsFor({ telegramToken: '', discordToken: 'D' })).toEqual(['discord']);
    expect(platformsFor({ telegramToken: 'T', discordToken: 'D' })).toEqual(['telegram', 'discord']);
  });

  it('owner 后来又连了一个平台（或断开、换了 token）→ 察觉到变化', async () => {
    // A bridge that started on Telegram must not ignore a Discord bot connected later: the owner
    // pressed Connect and would see nothing happen. It notices, and the caller restarts on it.
    const running = { telegramToken: 'T', discordToken: '' };
    vi.stubGlobal('fetch', respondWith([
      { telegram_token: 'T' }, { telegram_token: 'T', discord_token: 'D' },
    ]));
    const next = await waitForChange('http://backend:8000', running, { everyMs: 1 });
    expect(next).toEqual({ telegramToken: 'T', discordToken: 'D' });
  });

  it('内部口一时连不上不算变化（不能因为网络抖一下就把桥重启）', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(() => {
      n += 1;
      if (n === 1) return Promise.reject(new Error('ECONNREFUSED'));
      return Promise.resolve({
        ok: true, json: () => Promise.resolve({ telegram_token: 'T2' }),
      } as Response);
    }));
    const next = await waitForChange('http://backend:8000',
      { telegramToken: 'T', discordToken: '' }, { everyMs: 1 });
    expect(next.telegramToken, 'the unreachable poll was not read as "all disconnected"').toBe('T2');
  });

  it('内部口暂时挂了也接着等，不把桥拖死', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(() => {
      n += 1;
      if (n === 1) return Promise.reject(new Error('ECONNREFUSED'));
      return Promise.resolve({
        ok: true, json: () => Promise.resolve({ telegram_token: 'T-3' }),
      } as Response);
    }));
    // It's normal for the backend to come up after the bridge (compose starts both
    // containers at the same time). If the bridge exited on the first failed
    // connection, it would never come up, and the log would only say ECONNREFUSED.
    expect((await waitForConfig('http://backend:8000', { everyMs: 1 })).telegramToken).toBe('T-3');
  });
});
