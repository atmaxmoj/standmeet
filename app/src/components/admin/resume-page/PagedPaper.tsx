// PagedPaper —— the editor canvas as the pages the PDF will have: one sheet per page on the desk (in
// the owner's paper size, Letter or A4), the résumé flowing over them. use-resume-pages moves any
// block that would cross a page's bottom margin to the next page (the same rule print.css gives
// Chromium), so what the owner sees page by page is what prints page by page.

'use client';

import type { CSSProperties, ReactNode } from 'react';

import { paperSpec, type PaperSize } from '@/lib/admin/resume-pages';
import { useResumePages } from '@/lib/admin/use-resume-pages';

export function PagedPaper(
  { vars, paper, children }: { vars: CSSProperties; paper: PaperSize; children: ReactNode },
) {
  const { flowRef, pages, geometry } = useResumePages(paper);
  const spec = paperSpec(paper);
  const stride = geometry.pageHeight + geometry.gap;
  return (
    <div className="min-h-full flex justify-center items-start bg-black/5 py-8 px-4">
      <div
        data-resume-paper
        data-paper={paper}
        className="relative max-w-full"
        // eslint-disable-next-line no-restricted-syntax -- the sheet width is the owner's paper size
        style={{ width: `${spec.widthPx}px` }}
      >
        {Array.from({ length: pages }, (_, i) => (
          <div
            key={i}
            data-resume-sheet
            className="sm-resume-paper absolute inset-x-0 shadow-[0_2px_24px_rgba(0,0,0,0.12)]"
            // eslint-disable-next-line no-restricted-syntax -- each sheet's offset and proportions come from the paper size
            style={{ top: `${i * stride}px`, aspectRatio: `1 / ${spec.ratio}` }}
          />
        ))}
        <div
          ref={flowRef}
          className="sm-resume-paper relative px-[7.5%]"
          // eslint-disable-next-line no-restricted-syntax -- accent/font-scale vars + the page geometry are runtime values
          style={{
            ...vars,
            background: 'transparent',
            paddingTop: `${geometry.margin}px`,
            paddingBottom: `${geometry.margin}px`,
            minHeight: `${pages * stride - geometry.gap}px`,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
