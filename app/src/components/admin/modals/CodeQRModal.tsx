// CodeQRModal —— 显示某个 code 的大 QR + share link。

'use client';

import { useTranslations } from 'next-intl';

import { Btn } from '@/components/admin/atoms/Btn';
import { QRCode } from '@/components/admin/atoms/QRCode';
import { ModalShell } from '@/components/admin/modals/ModalShell';
import { buildShareLink } from '@/lib/admin/code-share';

import type { CodeView } from '@/lib/admin/use-codes';

type Props = { code: CodeView; onClose: () => void };

export function CodeQRModal({ code, onClose }: Props) {
  const link = buildShareLink(code.code);
  return (
    <ModalShell onClose={onClose} kicker="scan / share" title={code.label}>
      <div className="px-7 py-8 flex flex-col items-center">
        <div className="p-4 border border-(--color-rule) bg-(--color-paper)">
          <QRCode value={link} size={240} />
        </div>
        <QRMeta code={code.code} link={link} />
        <QRActions link={link} />
        <QRRoleStatus roleID={code.assumed_role_id} status={code.status} />
      </div>
    </ModalShell>
  );
}

function QRMeta({ code, link }: { code: string; link: string }) {
  return (
    <div className="mono text-[11px] tracking-[0.04em] text-(--color-muted) mt-5 text-center">
      <div className="text-(--color-ink)">{code}</div>
      <div className="mt-1 text-(--color-faint) break-all">{link}</div>
    </div>
  );
}

function QRActions({ link }: { link: string }) {
  const t = useTranslations('adminShell.codeQr');
  const copy = () => {
    typeof navigator !== 'undefined' && void navigator.clipboard?.writeText(link);
  };
  return (
    <div className="flex items-center gap-3 mt-6">
      <Btn kind="outline" onClick={copy}>{t('copyLink')}</Btn>
      <Btn kind="outline" onClick={() => window.print()}>{t('printQr')}</Btn>
    </div>
  );
}

function QRRoleStatus({ roleID, status }: { roleID: string; status: string }) {
  const t = useTranslations('adminShell.codeQr');
  return (
    <div className="mt-7 pt-5 border-t border-(--color-rule) w-full mono text-[10px] tracking-[0.12em] text-(--color-faint) leading-[1.7] text-center">
      <div>{t('roleLabel')} <span className="text-(--color-muted)">{roleID.slice(0, 8)}…</span></div>
      <div className="text-(--color-faint)">{t('statusLine', { status })}</div>
    </div>
  );
}
