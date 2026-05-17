// docker.ts —— compose 管理：down -v 起干净 instance、抓 setup token。
//
// 所有 spec 共用：resetInstance 在 test 开始时调一次，让数据库 / Redis
// 体积归零；findSetupToken 从 backend 日志里提取一次性 token。

import { execSync } from 'node:child_process';

const COMPOSE = '-f ../docker-compose.dev.yml -p standmeet-dev';

export function resetInstance(): void {
  execSync(`docker compose ${COMPOSE} down -v`, { stdio: 'inherit' });
  execSync(`docker compose ${COMPOSE} up -d --wait`, { stdio: 'inherit' });
}

export function findSetupToken(): string {
  const logs = execSync(`docker compose ${COMPOSE} logs backend --no-color`).toString();
  const m = logs.match(/setup\?t=([\w-]+)/);
  if (!m) throw new Error('setup token not found');
  return m[1] ?? '';
}
