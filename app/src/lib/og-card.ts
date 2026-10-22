// og-card.ts —— the 1200×630 share-card picture (Satori, via next/og): dark paper, a headline of
// at most three lines, an optional line under it, the site's address at the foot. Satori takes
// Tailwind through a `tw` prop, which is not a DOM attribute — so the tree is built with
// createElement, not JSX.

import { createElement, type ReactElement, type ReactNode } from 'react';
import { ImageResponse } from 'next/og';

import { fetchInstance } from '@/lib/api/instance';
import { fetchHomepageSEO } from '@/lib/api/microsites';
import { siteOrigin } from '@/lib/share-card';

export const FOREVER = 'public, max-age=31536000, immutable';
const A_DAY = 'public, max-age=86400';

// clip —— at most n characters, cut at a word. ponytail: a character budget stands in for
// measured lines (64px Noto Sans fits ~28 characters a line, three lines ~84); measure with
// Satori's layout if titles in wide letters overflow.
function clip(text: string, n: number): string {
  if (text.length <= n) {
    return text;
  }
  const cut = text.slice(0, n);
  const at = cut.lastIndexOf(' ');
  return `${at > 0 ? cut.slice(0, at) : cut}…`;
}

const box = (tw: string, ...children: ReactNode[]): ReactElement => createElement('div', { tw }, ...children);

export function drawCard(headline: string, line: string, mark: string, cache: string): ImageResponse {
  const under = line === '' ? null : box('flex mt-8 text-[30px] text-[#A8A092]', clip(line, 110));
  return new ImageResponse(
    box('flex flex-col justify-between w-full h-full bg-[#1B1814] px-20 py-16',
      box('flex w-20 h-2 bg-[#B5391C]'),
      box('flex flex-col', box('flex text-[64px] leading-tight text-[#F3EFE6]', clip(headline, 84)), under),
      box('flex text-[28px] text-[#D9583A]', mark)),
    { width: 1200, height: 630, headers: { 'Cache-Control': cache } },
  );
}

// siteMark —— the site's address without its scheme ("sijie.xyz").
export async function siteMark(): Promise<string> {
  return (await siteOrigin()).replace(/^https?:\/\//, '');
}

// drawSiteCard —— the owner's name, the homepage's first sentence, the address. Also what a
// writing's card falls back to.
export async function drawSiteCard(): Promise<ImageResponse> {
  const [instance, seo] = await Promise.all([
    fetchInstance().catch(() => null), fetchHomepageSEO(),
  ]);
  const name = instance?.name || seo.title || 'StandMeet';
  const first = seo.description.match(/^.*?[.!?。！？](?=\s|$)/)?.[0] ?? seo.description;
  return drawCard(name, first, await siteMark(), A_DAY);
}
