// config.ts —— the bridge's bot token **comes from this instance**, not from an env var.
//
// Why: the token is an owner credential, the same class of thing as the mail / calendar
// credentials — those all get filled in through the admin UI and land encrypted in
// `owner_connectors`. Sticking the IM token in an env var separately would give this one
// credential a second home: the owner would have to go edit a file and restart a
// container, right after they just edited every other connector in the UI
// ([[a fact belongs to the party that produces it]]).
//
// So compose only carries **wiring** (the backend address), never a setting.

/** IMConfig —— which IM this instance is currently configured with. Empty token = owner hasn't configured one yet. */
export interface IMConfig {
  telegramToken: string;
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
  const body = (await res.json()) as { telegram_token?: unknown };
  const t = body.telegram_token;
  return { telegramToken: typeof t === 'string' ? t : '' };
}

/**
 * waitForToken —— waits until the owner has finished configuring it.
 *
 * **Unconfigured is not an error**: an instance that hasn't connected an IM yet is
 * perfectly normal. Idling and waiting beats crashing, or spamming a screen of auth
 * failures — the latter would make the owner think something is broken.
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
      said = true; // Say it once: repeating the same line every 15 seconds would make the log unreadable
    }
    await new Promise((r) => setTimeout(r, every));
  }
}
