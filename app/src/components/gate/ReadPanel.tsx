// ReadPanel —— gate 上「不用码、也不用自带 AI，直接读」那条路。
//
// 为什么要有：gate 原来对没有码的访客只给两扇门 —— 输码，或者 BYOAI（要访客自己掏一把
// API key）。而这台实例上**已经公开**的 wiki 和 writings，在这一页上一个链接都没有；
// 页面自己的文案还写着「bring your own AI to chat with the public corpus」——
// 承认了公开语料存在，却不告诉人它在哪。顶栏在这一页也没有导航（`/wiki` 那条顶栏有
// WRITING / CHAT，gate 这条没有），所以访客从这里出不去。
// 于是「读一读他写了什么」这个最低门槛的动作，成本比「去弄一把 OpenAI key」还高。
//
// **有东西才开门**：`/wiki` 和 `/writings` 各自的计数为 0 时不渲染那一条。
// 空的入口比没有入口更糟 —— 点进去是一张空页，而访客不知道是自己走错了还是产品坏了。
// 两个都为 0 时整块不出现，gate 回到原来那两扇门。

import Link from 'next/link';
import { useTranslations } from 'next-intl';

type Props = { publicWiki: number; publicWritings: number };

const LINK_CLS = 'mono text-[12px] tracking-[0.14em] uppercase text-(--color-accent) '
  + 'hover:text-(--color-ink) transition-colors no-underline';

export function ReadPanel({ publicWiki, publicWritings }: Props) {
  return publicWiki + publicWritings > 0
    ? <ReadPanelBody publicWiki={publicWiki} publicWritings={publicWritings} />
    : null;
}

// `mb-14` 是必须的：BYOAIPanel 自己不带外边距（它以前紧跟在 `<Sep />` 后面）。
// 不给的话 `WRITINGS · 1 →` 会贴着下一块的 kicker `NO CODE? · BYOAI`，两块读起来像一块，
// 那条链接看上去是 BYOAI 的一部分。
function ReadPanelBody({ publicWiki, publicWritings }: Props) {
  const t = useTranslations('gate.read');
  return (
    <section className="mt-14 mb-14" data-testid="gate-read-panel">
      <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted) mb-2">
        {t('kicker')}
      </div>
      <h2 className="font-serif text-(--color-ink) text-[clamp(26px,4vw,34px)] font-[380] tracking-[-0.02em] leading-[1.1] mb-3">
        {t('heading')}
      </h2>
      <p className="text-(--color-muted) max-w-[62ch] mb-5">{t('body')}</p>
      {/* 两条链接不挂 testid：`Link` 是组件，testid 只能落在裸 DOM 元素上。
          要定位它们就按可访问名字走（`getByRole('link', { name: /wiki/ })`）—— 那也正是
          真人认它们的方式。 */}
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <ReadLink href="/wiki" label={t('wiki')} count={publicWiki} />
        <ReadLink href="/writings" label={t('writings')} count={publicWritings} />
      </div>
    </section>
  );
}

// 计数印在链接上，不是装饰：它是访客判断「这扇门后面有没有东西」的唯一依据，
// 而这一页别的地方不讲这台实例公开了多少。数为 0 的那一条根本不渲染。
function ReadLink({ href, label, count }: { href: string; label: string; count: number }) {
  return count > 0
    ? (
      <Link href={href} className={LINK_CLS}>
        {label} <span className="text-(--color-faint)">· {count} →</span>
      </Link>
    )
    : null;
}
