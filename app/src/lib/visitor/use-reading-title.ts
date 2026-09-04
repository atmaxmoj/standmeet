// use-reading-title — the wiki entry the reader is currently on, for the top
// bar's reading tag. Derived from the URL + the document title (the entry
// page's generateMetadata sets it), never passed down as a prop: passing it
// would force the /wiki layout to re-render per article — the exact coupling
// the reader-shell refactor (c215f0be) removed, same reason the tree highlight
// is URL-derived inside WikiTreeView.
'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

// an entry path is /wiki/<something> (a locale prefix like /zh is tolerated);
// the bare /wiki index carries no reading tag.
const ENTRY = /\/wiki\/.+/;

export function useReadingTitle(): string | undefined {
  const pathname = usePathname() ?? '';
  const [title, setTitle] = useState<string>();
  useEffect(() => {
    setTitle(ENTRY.test(pathname) ? document.title : undefined);
  }, [pathname]);
  return title;
}
