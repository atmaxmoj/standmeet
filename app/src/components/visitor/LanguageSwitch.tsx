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
'use client';

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
    <a
      href={`${pathname}?lang=${option.code}`}
      hrefLang={option.code}
      data-testid={`language-${option.code}`}
      aria-current={active ? 'true' : undefined}
      className={cls}
    >
      {option.label}
    </a>
  );
}
