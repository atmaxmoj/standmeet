// NewlyCreatedBanner —— 刚 Generate 出来的 Ed25519 keypair。显示 keyId
// (复制到 credentials.json) + PEM (Download 成 .pem 文件保存)。仅一次：
// 关掉之后服务器不再返私钥 (要再用就 Revoke + Generate 一个新的)。

'use client';

import { useTranslations } from 'next-intl';

interface CreatedToken { plaintext: string; name: string; id: string }

type Props = { created: CreatedToken | null; dismiss: () => void };

export function NewlyCreatedBanner({ created, dismiss }: Props) {
  return created ? <Card created={created} dismiss={dismiss} /> : null;
}

function Card({ created, dismiss }: { created: CreatedToken; dismiss: () => void }) {
  const t = useTranslations('adminIntegrations.newlyCreated');
  return (
    <div className="border border-(--color-accent) p-4 space-y-3 mb-4" data-testid="new-token">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-accent)">
        {t('warning')}
      </div>
      <div className="reading-tight text-sm text-(--color-muted)">{created.name}</div>
      <KeyIDRow keyID={created.id} />
      <PEMBlock pem={created.plaintext} fileName={`standmeet-key-${created.id.slice(0, 8)}.pem`} />
      <DismissBtn dismiss={dismiss} />
    </div>
  );
}

function KeyIDRow({ keyID }: { keyID: string }) {
  const t = useTranslations('adminIntegrations.newlyCreated');
  return (
    <div>
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-1">
        {t('keyId')}
      </div>
      <code data-testid="key-id" className="mono text-[13px] break-all block text-(--color-ink)">
        {keyID}
      </code>
    </div>
  );
}

function PEMBlock({ pem, fileName }: { pem: string; fileName: string }) {
  const t = useTranslations('adminIntegrations.newlyCreated');
  const dataURL = `data:application/x-pem-file;base64,${btoa(pem)}`;
  return (
    <div>
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-1">
        {t('pem')}
      </div>
      <code
        data-testid="key-pem"
        className="mono text-[11px] leading-[1.45] block whitespace-pre-wrap break-all border border-(--color-rule)/70 p-2 max-h-[180px] overflow-y-auto"
      >
        {pem}
      </code>
      <a
        href={dataURL}
        download={fileName}
        data-testid="key-pem-download"
        className="inline-block mt-2 mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-ink) underline underline-offset-4 hover:text-(--color-accent)"
      >
        {t('download')}
      </a>
    </div>
  );
}

function DismissBtn({ dismiss }: { dismiss: () => void }) {
  const t = useTranslations('adminIntegrations.newlyCreated');
  return (
    <button
      type="button"
      onClick={dismiss}
      className="mono text-[10.5px] tracking-[0.12em] text-(--color-muted) hover:text-(--color-ink)"
    >
      {t('dismiss')}
    </button>
  );
}
