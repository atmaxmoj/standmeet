// WikiTopBar —— reader 顶栏,对齐设计 wiki.js TopBar。永远在(无 session 也在),
// 只有 chat dock 才需要 code。左:standmeet / handle · wiki(wiki 用 accent 标当前
// 区)+ 有 session 时 ● unlocked·CODE / byoai·public scope。右:writing · chat ·
// 主题切换(dark/light)。border-bottom + 全宽。
//
// 组件层禁 if:全三元 + 抽小组件;主题 state 走 use-theme(SSR 安全)。

'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { useTheme } from '@/lib/page/use-theme';

const NAV_CLS =
  'mono text-[11px] tracking-[0.14em] uppercase text-(--color-muted) '
  + 'hover:text-(--color-ink) transition-colors no-underline';

// flex-wrap：窄屏上品牌那一组和导航那一组放不进一行。上一版两组都不换行也不收缩，于是它们
// **互相压上去** —— 面包屑的 `WIKI` 和导航的 `WRITINGS` 渲成一串 `WIKIWRITING`，右端的主题
// 开关还被裁在屏幕外。换行而不是砍掉任何一项：导航落到第二行，一个入口都不少。
export function WikiTopBar({ handle, reading }: { handle: string; reading?: string }) {
  const { dark, toggle } = useTheme();
  const t = useTranslations('visitor.wikiTopBar');
  return (
    <header
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 pt-[18px] pb-[14px] px-4 sm:px-6 lg:px-8 border-b border-(--color-rule)"
      data-testid="wiki-topbar"
    >
      <Brand handle={handle} reading={reading} />
      <nav className="flex items-baseline gap-5 sm:gap-6">
        <Link href="/writings" className={NAV_CLS}>{t('writing')}</Link>
        <Link href="/" className={NAV_CLS}>{t('chat')}</Link>
        <button
          type="button"
          onClick={toggle}
          aria-label="toggle theme"
          className={`${NAV_CLS} bg-transparent border-0 cursor-pointer`}
          data-testid="wiki-theme-toggle"
        >
          {dark ? 'light' : 'dark'}
        </button>
      </nav>
    </header>
  );
}

function Brand({ handle, reading }: { handle: string; reading?: string }) {
  const t = useTranslations('visitor.wikiTopBar');
  return (
    <div className="mono text-[11px] tracking-[0.14em] uppercase flex flex-wrap items-baseline gap-x-3 gap-y-1 min-w-0">
      <Link href="/" className="text-(--color-ink) no-underline">{t('brand')}</Link>
      <span className="text-(--color-faint)">/</span>
      <Link href="/" className="text-(--color-muted) no-underline">{handle}</Link>
      <span className="text-(--color-faint)">·</span>
      <Link href="/wiki" className="text-(--color-accent) no-underline">{t('wiki')}</Link>
      <ReadingTag reading={reading} />
    </div>
  );
}

// ReadingTag —— 阅读态:顶栏标出当前正在读的条目(reader 才传,index/列表不传)。
function ReadingTag({ reading }: { reading?: string }) {
  return reading ? (
    <span className="inline-flex items-baseline gap-3 normal-case" data-testid="wiki-topbar-reading">
      <span className="text-(--color-faint)">·</span>
      <span className="text-(--color-muted) text-[10.5px] tracking-[0.06em] max-w-[24ch] truncate">
        {reading}
      </span>
    </span>
  ) : null;
}

// 这条顶栏**不再讲这次会话**(UX-80)。它以前挂着一个 `● unlocked · VOICE-01`,
// 而它正下方那条会话横条同时写着 `● VOICE · CODE · VOICE-01 · you · <名字> … EXIT SESSION`
// —— 同一件事、两条整宽横条、两颗 live dot，摞在正文前面。
//
// 两者的出现条件**逐字相同**(`session.code !== null || session.byoai`,也就是横条的渲染条件),
// 所以去掉这个标签一个信息都不丢:会话的事归会话横条,这条顶栏只回答「这是谁的站、我在哪一区、
// 去哪儿」。聊天那一屏在 UX-53 已经这么收过一次(把站点身份塞进横条的槽);读者页两条都要留着 ——
// 它没有会话时也得有导航 —— 所以这里收的是**重复**，不是横条本身。
