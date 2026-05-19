// TokenRow —— 单个 token 的行视图。reveal toggle 是 client-only（值是 masked id；
// backend 只在 create 时返回 plaintext，list 时不再回）。

'use client';

import { useState } from 'react';

import { Chip } from '../../atoms/Chip';
import { maskSecret, type TokenItem } from '@/lib/admin/use-tokens';

type Props = {
  token: TokenItem;
  deleteToken: (id: string) => Promise<void>;
};

export function TokenRow({ token, deleteToken }: Props) {
  return (
    <li className="border border-(--color-rule) rounded-sm p-4 bg-(--color-surface)/40">
      <TokenRowHead token={token} deleteToken={deleteToken} />
      <TokenSecretRow token={token} />
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
        <Chip>read</Chip>
        <Chip>write</Chip>
        <RevokeBtn token={token} deleteToken={deleteToken} />
      </div>
    </div>
  );
}

function RevokeBtn({ token, deleteToken }: Props) {
  return (
    <button
      type="button"
      onClick={() => void deleteToken(token.id)}
      data-testid={`token-delete-${token.name}`}
      className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-faint) hover:text-(--color-accent)"
    >
      revoke
    </button>
  );
}

function TokenSecretRow({ token }: { token: TokenItem }) {
  const [reveal, setReveal] = useState(false);
  // backend 不再返回 plaintext —— reveal 显示一个 placeholder 提示 owner 在 create
  // 时就该已经存了 plaintext。
  const fake = `sm_live_${token.id}_secret_redacted`;
  return (
    <div className="flex items-baseline gap-3 border-t border-(--color-rule)/70 pt-3 mt-2">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) shrink-0">secret</span>
      <SecretCode reveal={reveal} fake={fake} />
      <RevealToggle reveal={reveal} setReveal={setReveal} />
    </div>
  );
}

function SecretCode({ reveal, fake }: { reveal: boolean; fake: string }) {
  return (
    <code className="mono flex-1 min-w-0 truncate text-[13px] text-(--color-muted)">
      {reveal ? '(plaintext only available at creation)' : maskSecret(fake)}
    </code>
  );
}

function RevealToggle({
  reveal, setReveal,
}: { reveal: boolean; setReveal: (fn: (r: boolean) => boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => setReveal((r) => !r)}
      className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink) shrink-0"
    >
      {reveal ? 'hide' : 'reveal'}
    </button>
  );
}
