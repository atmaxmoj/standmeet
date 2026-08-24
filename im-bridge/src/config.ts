// config.ts —— 桥的 bot token **从这台实例取**，不从环境变量取。
//
// 为什么：token 是 owner 的凭据，跟 mail / calendar 的凭据是同一类东西 ——
// 那些都在 admin 界面里填、加密落 `owner_connectors`。把 IM 的 token 单独塞进 env，
// 等于这一个凭据有第二个家：owner 要去改一个文件、重启一个容器，
// 而他刚在界面上改过其它所有连接器（[[事实归产生它的那一方]]）。
//
// 所以 compose 里只有**接线**（后端地址），没有设置。

/** IMConfig —— 这台实例当前配了哪个 IM。token 为空 = owner 还没配。 */
export interface IMConfig {
  telegramToken: string;
}

/**
 * fetchIMConfig —— 问后端「我现在该用哪个 token」。
 *
 * 走内部口（跟 builder 的 `/internal/builds/claim` 同一条路子）：这个口在容器网络里，
 * 不对外暴露；桥的问答仍然走**访客那条公开路**，跟浏览器一样。
 * 两条路分开是有意的：桥要的授权只有「取自己的配置」，不该顺手拿到 owner 的面。
 */
export async function fetchIMConfig(internalURL: string): Promise<IMConfig> {
  const res = await fetch(`${internalURL}/internal/im/config`);
  if (!res.ok) throw new Error(`im config: ${res.status}`);
  const body = (await res.json()) as { telegram_token?: unknown };
  const t = body.telegram_token;
  return { telegramToken: typeof t === 'string' ? t : '' };
}

/**
 * waitForToken —— 等到 owner 配好为止。
 *
 * **没配不是错误**：一台还没接 IM 的实例是完全正常的。空转等着，
 * 比起来就崩、或者刷一屏认证失败要好 —— 后者会让 owner 以为是坏了。
 */
export async function waitForToken(
  internalURL: string, opts: { everyMs?: number; log?: (m: string) => void } = {},
): Promise<string> {
  const every = opts.everyMs ?? 15_000;
  let said = false;
  for (;;) {
    const cfg = await fetchIMConfig(internalURL).catch(() => ({ telegramToken: '' }));
    if (cfg.telegramToken !== '') return cfg.telegramToken;
    if (!said) {
      opts.log?.('im-bridge: no chat platform configured yet — waiting. ' +
        'Connect one under /admin/connectors.');
      said = true; // 只说一次：每 15 秒刷同一句，日志就没法看了
    }
    await new Promise((r) => setTimeout(r, every));
  }
}
