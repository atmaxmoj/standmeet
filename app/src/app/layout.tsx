// Root layout —— 全局字体（Newsreader + JetBrains Mono）+ 全局 CSS。
//
// Fonts 通过 next/font 自托管，避免在 docker / CI 里向 Google CDN 拉资源
// 让 build 变慢 + privacy-friendly。fallback Georgia / ui-monospace 兜底。

import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Newsreader, JetBrains_Mono } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';

import '@/app/globals.css';
import { ToastProvider, Toaster } from '@/lib/ui/toast';

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

// RootLayout —— async：locale 由 next-intl 的 request config 给（现在恒为 'en'）。
// `<html lang>` 跟着它走，不写死 —— 写死的那一刻，加第二种语言就又多一处要记得改的地方。
export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${newsreader.variable} ${jetbrainsMono.variable}`}>
      <body>
        <NextIntlClientProvider>
          <ToastProvider>
            {children}
            <Toaster />
          </ToastProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
