// config.test.ts —— token **从实例取**这件事。
//
// 这一组存在的理由是那条产品规矩：凭据在 UI 里配，不在 env 里配。
// 桥要是偷偷读一个环境变量，owner 就得去改文件、重启容器 ——
// 而他刚在界面上改过其它所有连接器。

import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchIMConfig, waitForToken } from '../src/config.js';

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
    // 「还没配」是一台实例的正常状态，不是故障。当成错误的话，
    // 一台没接 IM 的实例会一直有个容器在报错，owner 会以为坏了。
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
    const token = await waitForToken('http://backend:8000',
      { everyMs: 1, log: (m) => logs.push(m) });
    expect(token).toBe('T-2');
    // 那句「还没配」只说一次 —— 每 15 秒刷一遍同一句，日志就没法看了。
    expect(logs, 'the waiting notice is said once, not on every poll').toHaveLength(1);
    expect(logs[0]).toMatch(/admin\/connectors/);
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
    // 后端比桥晚起来是常态（compose 里两个容器同时拉起）。
    // 第一次连不上就退出的话，桥永远起不来，而日志只说 ECONNREFUSED。
    expect(await waitForToken('http://backend:8000', { everyMs: 1 })).toBe('T-3');
  });
});
