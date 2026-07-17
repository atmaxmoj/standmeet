// Seal —— gate 页面顶部的"封口"圆环：三层圆，里面 mono 写
// "standmeet · <handle> / private"。视觉上立刻告诉访客这页是 gated。

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
