import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';

// M2 DoD：干净 instance 启动 → backend log 抓 setup URL → POST claim
// 成功 → owners 表新增一行 + is_claimed=true → 第二次 claim 拒绝。
//
// 这个测试 reset 整个 dev stack（docker volumes 清空 + 重启 backend），
// 所以**不能和其他 spec 并发跑**。Playwright workers=1 已经在 config 里设。
//
// 注意：这个测试要求 dev-up 已起，且当前 instance 是干净的 / 重置过的。
// 平时 dev workflow 跑这个测试前先 `make dev-down && docker volume rm
// standmeet-dev_pgdata && make dev-up`。CI 走 `make test:m2` 的脚本会
// 自动做这件事。

const COMPOSE = '-f ../docker-compose.dev.yml -p standmeet-dev';

function resetInstance(): void {
  execSync(`docker compose ${COMPOSE} down -v`, { stdio: 'inherit' });
  execSync(`docker compose ${COMPOSE} up -d --wait`, { stdio: 'inherit' });
}

function backendLogs(): string {
  return execSync(`docker compose ${COMPOSE} logs backend --no-color`).toString();
}

function findSetupURL(logs: string): string {
  const match = logs.match(/setup\?t=([\w-]+)/);
  if (!match) throw new Error('setup token not found in backend logs');
  return match[0];
}

function parseToken(setupURL: string): string {
  const m = setupURL.match(/t=([\w-]+)/);
  if (!m) throw new Error('cannot parse token from URL');
  return m[1];
}

test.describe.serial('M2 first-run claim', () => {
  test('fresh instance prints setup URL, claim succeeds, re-claim rejected', async ({ request }) => {
    resetInstance();

    // Setup URL is in backend stdout banner + log
    const logs = backendLogs();
    const setupURL = findSetupURL(logs);
    const token = parseToken(setupURL);

    // 1. 第一次 claim 成功
    const first = await request.post('/api/admin/claim', {
      data: {
        token,
        email: 'sijie@example.com',
        password: 'correct-horse-battery-staple',
        handle: 'sijie',
        full_name: 'Sijie Wang',
      },
    });
    expect(first.status()).toBe(200);
    const owner = await first.json();
    expect(owner.email).toBe('sijie@example.com');
    expect(owner.handle).toBe('sijie');
    expect(owner.full_name).toBe('Sijie Wang');
    expect(owner.owner_id).toMatch(/^[0-9a-f-]{36}$/);

    // 2. 第二次 claim 必须拒绝（token 已消费）
    const second = await request.post('/api/admin/claim', {
      data: {
        token,
        email: 'someone-else@example.com',
        password: 'another-pw',
        handle: 'someoneelse',
        full_name: 'Some One',
      },
    });
    expect(second.status()).toBe(401);
    const err = await second.json();
    expect(err.error.code).toBe('invalid_setup_token');
  });
});
