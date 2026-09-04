// PageNavWidget —— navigation to the owner's OTHER published custom pages (slug + title), so the
// homepage (or any page) links the rest of the site without hand-listing slugs. `exclude` drops
// the current page's own slug so a page never links to itself.
//
// Drop-in: `<PageNavWidget exclude="home" />`. Optional `heading` overrides the label.

'use client';

import React, { useEffect, useState } from 'react';
import type { CustomPageLink } from '@standmeet/sdk-core';

import { widgetClient } from './client.js';

export interface PageNavWidgetProps {
  readonly heading?: string;
  readonly exclude?: string;
}

export function PageNavWidget(
  { heading, exclude }: PageNavWidgetProps,
): React.ReactElement | null {
  const [pages, setPages] = useState<CustomPageLink[]>([]);
  useEffect(() => { widgetClient.fetchCustomPages().then(setPages).catch(() => undefined); }, []);

  const others = pages.filter((p) => p.slug !== exclude);
  if (others.length === 0) return null;
  return (
    <nav data-testid="page-nav-widget" className="w-full">
      <div className="mono text-[10px] tracking-[0.22em] uppercase text-(--color-faint) mb-4">
        {heading ?? 'elsewhere on this site'}
      </div>
      <ul className="flex flex-col gap-2">
        {others.map((p) => (
          <li key={p.slug}>
            <a
              href={`/p/${p.slug}/`}
              data-testid={`page-nav-widget-link-${p.slug}`}
              className="group inline-flex items-baseline gap-2 no-underline"
            >
              <span className="mono text-[11px] text-(--color-faint) group-hover:text-(--color-accent) transition-colors">
                ↗
              </span>
              <span className="font-serif text-(--color-ink) group-hover:text-(--color-accent) transition-colors text-[18px] leading-[1.4]">
                {p.title}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
