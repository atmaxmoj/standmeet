// Seal — the "wax seal" ring at the top of the gate page: three nested circles
// with mono text "standmeet · <handle> / private" inside. Visually tells the
// visitor at a glance that this page is gated.

import { useTranslations } from 'next-intl';

type Props = { handle: string };

export function Seal({ handle }: Props) {
  const t = useTranslations('gate.seal');
  return (
    <div className="relative shrink-0">
      <div className="seal">
        <div className="seal-text">
          <span>
            {t('brand', { handle })}<br />
            <span className="tracking-[0.32em]">{t('private')}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
