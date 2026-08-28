// LanguageSwitch —— 一条多语笔记的语言切换器。
//
// **不是** Obsidian 那排单选按钮:那一行是 vault 里的呈现件(靠 CSS 的 nth-of-type 撑着,
// 所以它天然只支持三种语言),同步进来时就被丢掉了。这里是我们自己的,N 种都行。
//
// 切换 = 换地址(`?lang=zh`),不是本地状态:
//   · 分享出去的链接带着语言,对方看到的是同一份;
//   · 爬虫和 agent 抓那个 URL 拿到的就是那一面(服务端渲染的);
//   · 后退键回到上一种语言,而不是回到上一页。
//
// 走 `next/link` 而不是裸 `<a>`:上面那三条**一条都不靠整页重载**,而裸 `<a>` 会把整份文档
// 重新加载一遍 —— 读者读到一半切个语言,页面白一下、滚动位置丢了。`Link` 是客户端导航,
// 地址照换、爬虫拿到的还是服务端那一面(同一个 URL)、后退键行为不变,只是不再重载。
// `scroll={false}` 是必须的:切语言不是换页,人还在读同一篇的同一处,不该被弹回顶部。
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { LanguageOption } from '@/lib/api/public';

export function LanguageSwitch({
  languages, current,
}: {
  languages: readonly LanguageOption[];
  current: string;
}) {
  const pathname = usePathname();
  // 一条笔记只有一种语言(绝大多数)→ 整个组件不出现:一个只有一个选项的切换器是噪声。
  return languages.length < 2 ? null : (
    <nav
      data-testid="language-switch"
      aria-label="language"
      className="flex items-baseline gap-2 mono text-[10px] tracking-[0.16em] uppercase"
    >
      {languages.map((l) => (
        <LanguageLink
          key={l.code} option={l} active={l.code === current} pathname={pathname}
        />
      ))}
    </nav>
  );
}

function LanguageLink({
  option, active, pathname,
}: {
  option: LanguageOption;
  active: boolean;
  pathname: string;
}) {
  const cls = active
    ? 'text-(--color-paper) bg-(--color-ink) px-1.5 py-0.5'
    : 'text-(--color-muted) hover:text-(--color-ink) px-1.5 py-0.5';
  return (
    // 不挂 `data-testid`：`Link` 是组件，testid 只能落在裸 DOM 元素上（闸门管这个）。
    // 定位走 `hrefLang` / 可访问名字 —— 那也正是读者认它们的方式。
    <Link
      href={`${pathname}?lang=${option.code}`}
      hrefLang={option.code}
      scroll={false}
      aria-current={active ? 'true' : undefined}
      className={cls}
    >
      {option.label}
    </Link>
  );
}
