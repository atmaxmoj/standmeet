// discord.test.ts —— the owner connects Discord with one field, the bot token, like Telegram.
//
// The Chat SDK's Discord adapter also demands an application id and a public key. The public key
// only verifies HTTP interactions, and the bridge never takes any (it listens on the Gateway, an
// outbound connection — a self-hosted instance has no public callback URL). The application id is
// written into the token itself: a bot token's first part is the base64 of the bot's user id,
// which is the application's id.

import { describe, expect, it } from 'vitest';

import { applicationIdFromToken, rejectHTTPInteractions } from '../src/discord.js';

describe('discord 只要一个 token', () => {
  it('application id 从 token 第一段解出来', () => {
    const id = '1010101010101010101';
    const token = `${Buffer.from(id).toString('base64').replace(/=+$/, '')}.GhIjKl.secret-part`;
    expect(applicationIdFromToken(token)).toBe(id);
  });

  it('不是 bot token 的形状 → 空串（让 adapter 当场报错，而不是拿个错 id 跑）', () => {
    expect(applicationIdFromToken('not-a-token')).toBe('');
    expect(applicationIdFromToken('7654321:BOTFATHER-telegram-shaped')).toBe('');
  });

  it('HTTP interactions 一律拒收：这个桥只走 Gateway', async () => {
    expect(await rejectHTTPInteractions()).toBe(false);
  });
});
