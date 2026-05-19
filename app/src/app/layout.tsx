// Root layout —— 全局字体（Newsreader + JetBrains Mono）+ 全局 CSS。
//
// Fonts 通过 next/font 自托管，避免在 docker / CI 里向 Google CDN 拉资源
// 让 build 变慢 + privacy-friendly。fallback Georgia / ui-monospace 兜底。

import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Newsreader, JetBrains_Mono } from 'next/font/google';

import '@/app/globals.css';

const newsreader = Newsreader({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  display: 'swap',
  variable: '--font-newsreader',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
});

export const metadata: Metadata = {
  title: 'StandMeet',
  description: 'A personal page that argues back.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${newsreader.variable} ${jetbrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
