// TokenRow —— Phase C: 一个 MCP key 的行视图。显 label (token.name)，
// key_id (token.id) — 公开 identifier，credentials.json 里写它。私钥不存
// server, owner generate 时已经 Download .pem，list 这里不再有 plaintext 可看。

'use client';

import { Chip } from '@/components/admin/atoms/Chip';
import { type TokenItem } from '@/lib/admin/use-tokens';
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
  return (
    <div className="flex items-baseline justify-between gap-4 flex-wrap">
      <div>
        <div className="font-serif text-(--color-ink) text-[17px] font-medium tracking-[-0.005em]">
          {token.name}
        </div>
        <div className="mono text-[10.5px] tracking-[0.06em] text-(--color-faint) mt-0.5">
          created {token.created_at} · last used {token.last_used_at ?? 'never'}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Chip>ed25519</Chip>
        <RevokeBtn token={token} deleteToken={deleteToken} />
      </div>
    </div>
  );
}

function RevokeBtn({ token, deleteToken }: Props) {
  // 一键破坏性动作 → useAction 收尾（成功 toast / 失败 report），删失败不再静默。
  const run = useAction();
  return (
    <button
      type="button"
      onClick={() => { void run(() => deleteToken(token.id), { success: 'Key deleted' }); }}
      data-testid={`token-delete-${token.name}`}
      className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-faint) hover:text-(--color-accent)"
    >
      revoke
    </button>
  );
}

function KeyIDRow({ keyID }: { keyID: string }) {
  return (
    <div className="flex items-baseline gap-3 border-t border-(--color-rule)/70 pt-3 mt-2">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) shrink-0">key id</span>
      <code className="mono flex-1 min-w-0 truncate text-[13px] text-(--color-muted)">
        {keyID}
      </code>
    </div>
  );
}
