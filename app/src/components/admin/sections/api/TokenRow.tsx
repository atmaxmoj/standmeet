// TokenRow — Phase C: row view of one MCP key. Shows label (token.name),
// key_id (token.id) — the public identifier, written into credentials.json.
// The private key isn't stored server-side; owner already Downloaded the
// .pem at generate time, so this list has no plaintext to show.

'use client';

import { useTranslations } from 'next-intl';

import { Chip } from '@/components/admin/atoms/Chip';
import { type TokenItem, tokenUsedFromView } from '@/lib/admin/use-tokens';
import { useAction } from '@/lib/ui/use-action';

type Props = {
  token: TokenItem;
  deleteToken: (id: string) => Promise<void>;
};

export function TokenRow({ token, deleteToken }: Props) {
  return (
    <li className="border border-(--color-rule) rounded-sm p-4 bg-(--color-surface)/40">
      <TokenRowHead token={token} deleteToken={deleteToken} />
      <KeyIDRow keyID={token.id} />
    </li>
  );
}

function TokenRowHead({ token, deleteToken }: Props) {
  const t = useTranslations('adminIntegrations.tokenRow');
  return (
    <div className="flex items-baseline justify-between gap-4 flex-wrap">
      <div>
        <div className="font-serif text-(--color-ink) text-[17px] font-medium tracking-[-0.005em]">
          {token.name}
        </div>
        <div className="mono text-[10.5px] tracking-[0.06em] text-(--color-faint) mt-0.5">
          {t('meta', {
            created: token.created_at,
            lastUsed: token.last_used_at ?? t('never'),
          })}
        </div>
        <LastUsedFrom token={token} />
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Chip>{t('algo')}</Chip>
        <RevokeBtn token={token} deleteToken={deleteToken} />
      </div>
    </div>
  );
}

// LastUsedFrom — where the key was last used (device · ip). Shown only once it has been used and
// we captured the origin (see tokenUsedFromView); a never-used or pre-feature key shows nothing.
function LastUsedFrom({ token }: { token: TokenItem }) {
  const t = useTranslations('adminIntegrations.tokenRow');
  const v = tokenUsedFromView(token);
  return v.shown ? (
    <div
      data-testid={`token-lastused-${token.name}`}
      className="mono text-[10px] tracking-[0.04em] text-(--color-faint) mt-0.5 truncate max-w-full"
    >
      {t('lastFrom', { device: v.device, ip: v.ip })}
    </div>
  ) : null;
}

function RevokeBtn({ token, deleteToken }: Props) {
  // A one-click destructive action → useAction handles the outcome
  // (success toast / failure report); a failed delete is no longer silent.
  const run = useAction();
  const t = useTranslations('adminIntegrations.tokenRow');
  return (
    <button
      type="button"
      onClick={() => { void run(() => deleteToken(token.id), { success: t('deletedToast') }); }}
      data-testid={`token-delete-${token.name}`}
      className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-faint) hover:text-(--color-accent)"
    >
      {t('revoke')}
    </button>
  );
}

function KeyIDRow({ keyID }: { keyID: string }) {
  const t = useTranslations('adminIntegrations.tokenRow');
  return (
    <div className="flex items-baseline gap-3 border-t border-(--color-rule)/70 pt-3 mt-2">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) shrink-0">{t('keyId')}</span>
      <code className="mono flex-1 min-w-0 truncate text-[13px] text-(--color-muted)">
        {keyID}
      </code>
    </div>
  );
}
