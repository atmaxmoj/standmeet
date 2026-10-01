// config.ts —— the bridge's bot token **comes from this instance**, not from an env var.
//
// Why: the token is an owner credential, the same class of thing as the mail / calendar
// credentials — those all get filled in through the admin UI and land encrypted in
// `block_connections`. Sticking the IM token in an env var separately would give this one
// credential a second home: the owner would have to go edit a file and restart a
// container, right after they just edited every other supplier in the UI
// ([[a fact belongs to the party that produces it]]).
//
// So compose only carries **wiring** (the backend address), never a setting.

/** IMConfig —— which IM this instance is currently configured with. Empty token = owner hasn't configured that platform yet. */
export interface IMConfig {
  telegramToken: string;
  discordToken: string;
}

export type Platform = 'telegram' | 'discord';

/** platformsFor —— the platforms to run: every one the owner connected. */
export function platformsFor(cfg: IMConfig): Platform[] {
  const out: Platform[] = [];
  if (cfg.telegramToken !== '') out.push('telegram');
  if (cfg.discordToken !== '') out.push('discord');
  return out;
}

/**
 * fetchIMConfig —— asks the backend "which token should I use right now?"
 *
 * Goes through the internal port (the same lane as builder's `/internal/builds/claim`):
 * this port lives inside the container network and is never exposed externally; the
 * bridge's actual chat traffic still goes through **the same public visitor path** as a
 * browser. Keeping the two paths separate is deliberate: the bridge's authorization
 * should only cover "fetch my own config", never incidentally reach the owner's surface.
 */
export async function fetchIMConfig(internalURL: string): Promise<IMConfig> {
  const res = await fetch(`${internalURL}/internal/im/config`);
  if (!res.ok) throw new Error(`im config: ${res.status}`);
  const body = (await res.json()) as { tokens?: unknown };
  return fromTokens(body.tokens);
}

/**
 * fromTokens —— the instance hands over its connected im suppliers as block id → token, naming no
 * platform (the kernel stays blind to blocks). Knowing which block is which chat platform is this
 * bridge's job: the `discord` block is Discord; the `telegram` block — and any credential supplier
 * created before blocks had names (an `up-…` id) — is Telegram.
 */
function fromTokens(raw: unknown): IMConfig {
  const tokens = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
  // trimmed here, once: a pasted token often carries a stray space or newline
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const others = Object.entries(tokens).filter(([id]) => id !== 'discord' && id !== 'telegram');
  return {
    telegramToken: str(tokens['telegram']) || str(others[0]?.[1]),
    discordToken: str(tokens['discord']),
  };
}

const NONE: IMConfig = { telegramToken: '', discordToken: '' };

/**
 * waitForChange —— resolves with the new configuration once it differs from `running`: the owner
 * connected another platform, disconnected one, or rotated a token. The bridge restarts on it
 * (compose's restart policy brings it back on the new configuration) — a platform connected after
 * the bridge started must not sit ignored while the owner wonders why nothing happens.
 * An unreachable backend is not a change (a network blip must not restart the bridge).
 */
export async function waitForChange(
  internalURL: string, running: IMConfig, opts: { everyMs?: number } = {},
): Promise<IMConfig> {
  const every = opts.everyMs ?? 15_000;
  for (;;) {
    await new Promise((r) => setTimeout(r, every));
    const cfg = await fetchIMConfig(internalURL).catch(() => running);
    if (cfg.telegramToken !== running.telegramToken || cfg.discordToken !== running.discordToken) {
      return cfg;
    }
  }
}

/**
 * waitForConfig —— waits until the owner has connected at least one platform, and returns the
 * whole configuration (a bridge runs every platform the owner connected).
 *
 * **Unconfigured is not an error**: an instance that hasn't connected an IM yet is
 * perfectly normal. Idling and waiting beats crashing, or spamming a screen of auth
 * failures — the latter would make the owner think something is broken.
 */
export async function waitForConfig(
  internalURL: string, opts: { everyMs?: number; log?: (m: string) => void } = {},
): Promise<IMConfig> {
  const every = opts.everyMs ?? 15_000;
  let said = false;
  for (;;) {
    const cfg = await fetchIMConfig(internalURL).catch(() => NONE);
    if (platformsFor(cfg).length > 0) return cfg;
    if (!said) {
      opts.log?.('im-bridge: no chat platform configured yet — waiting. ' +
        'Connect one under /admin/suppliers.');
      said = true; // Say it once: repeating the same line every 15 seconds would make the log unreadable
    }
    await new Promise((r) => setTimeout(r, every));
  }
}
