// Root layout — global fonts (Newsreader + JetBrains Mono) + global CSS.
//
// Fonts are self-hosted via next/font, avoiding a Google CDN fetch in docker / CI
// that would slow the build; also privacy-friendly. Georgia / ui-monospace as fallback.

import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Newsreader, JetBrains_Mono } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import { ChatLangProvider } from '@standmeet/sdk';

import '@/app/globals.css';
import { ThemeSync } from '@/components/page/ThemeSync';
import { fetchInstance } from '@/lib/api/instance';
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

// generateMetadata —— every page's <title> names whose site it is: "<page> — <owner>", and the
// owner's name alone where a page sets none. A crawler searching for the owner's name found only
// "StandMeet" and bare slugs before (2026-09-30). Degrades to "StandMeet" if the instance can't be read.
export async function generateMetadata(): Promise<Metadata> {
  const name = await ownerName();
  return {
    title: { template: `%s — ${name}`, default: name },
    description: 'A personal page that argues back.',
  };
}

async function ownerName(): Promise<string> {
  try {
    return (await fetchInstance()).name || 'StandMeet';
  } catch {
    return 'StandMeet';
  }
}

// RootLayout — async: locale comes from next-intl's request config (currently always 'en').
// `<html lang>` follows it instead of being hardcoded — hardcoding it would add one more
// place to remember when a second language is added.
export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${newsreader.variable} ${jetbrainsMono.variable}`}>
      <body>
        <NextIntlClientProvider>
          {/* The chat (from @standmeet/sdk) speaks the page's locale too. */}
          <ChatLangProvider lang={locale}>
          <ToastProvider>
            {/* Dark/light mounts here, present on every surface, */}
            {/* so nobody has to remember it (UX-94). */}
            <ThemeSync />
            {children}
            <Toaster />
          </ToastProvider>
          </ChatLangProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
