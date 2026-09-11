// pdf-inspect.ts —— pdfjs-dist wrapper for spec assertions on the gotenberg-rendered resume PDF.
// Covers what we'd otherwise eyeball:
//   - number of pages
//   - page dimensions in PDF points
//   - the extracted text layer (proves not image-only + content right)
//
// pdfjs-dist, NOT pdf-parse: pdf-parse@2 pins pdfjs-dist@5, while pdf-to-img@7 (fixtures/pdf-raster)
// pins pdfjs-dist@6, and the two majors in one tree made pdf-parse load a 6.x worker against its 5.x
// API ("API version 5.4.296 does not match Worker version 6.2.108"). One pdfjs for the whole suite
// removes the skew: this reads the text layer through the SAME pdfjs-dist@6 the rasterizer uses.
//
// The legacy Node build is imported by path (pdfjs-dist ships no `exports` map, and this is the build
// pdf-to-img itself uses in Node). That subpath carries no types, so its module is cast once to a
// minimal local surface — API-identical to the typed main entry, just the few calls used here.

import path from 'node:path';

export interface PDFInfo {
  pages: number;
  text: string;
  pageWidthPt: number;
  pageHeightPt: number;
}

interface PdfTextItem { str?: string; hasEOL?: boolean }
interface PdfPage { getTextContent(): Promise<{ items: PdfTextItem[] }> }
interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
}
interface GetDocumentSrc {
  data: Uint8Array;
  isEvalSupported?: boolean;
  standardFontDataUrl?: string;
  cMapUrl?: string;
  cMapPacked?: boolean;
}
interface PdfLoadingTask { promise: Promise<PdfDoc>; destroy(): Promise<void> }
interface PdfjsModule { getDocument(src: GetDocumentSrc): PdfLoadingTask }

// pdfjs-dist ships the CMaps (CJK glyph→Unicode tables) and the standard-14 font data next to its
// package.json. getTextContent() needs both to recover the text layer of a CID/embedded-font PDF —
// without them CJK comes back as tofu and even Latin sentinels drop out. Point pdfjs at the on-disk
// assets, the same way pdf-to-img (fixtures/pdf-raster) does.
const pdfjsAssetDir = path.dirname(require.resolve('pdfjs-dist/package.json'));

export async function inspectPDF(buf: Buffer): Promise<PDFInfo> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs') as unknown as PdfjsModule;
  // In pdfjs-dist@6 destroy() lives on the loading task, not the document proxy.
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    isEvalSupported: false,
    standardFontDataUrl: path.join(pdfjsAssetDir, `standard_fonts${path.sep}`),
    cMapUrl: path.join(pdfjsAssetDir, `cmaps${path.sep}`),
    cMapPacked: true,
  });
  const doc = await task.promise;
  try {
    const parts: string[] = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      // Concatenate item strings directly — pdfjs already carries the intra-line spaces inside each
      // `str`, so joining with our own space would wedge blanks between adjacent CJK glyphs pdfjs
      // happened to split into separate items (中文… → 中 文 …). A newline at each hasEOL keeps
      // words on different lines from fusing.
      parts.push(content.items.map((it) => (it.str ?? '') + (it.hasEOL ? '\n' : '')).join(''));
    }
    const dims = firstMediaBox(buf);
    return { pages: doc.numPages, text: parts.join('\n'), pageWidthPt: dims.width, pageHeightPt: dims.height };
  } finally {
    await task.destroy();
  }
}

// /MediaBox [llx lly urx ury] — PDF page geometry. Scan the raw bytes;
// gotenberg-produced PDFs always declare it inline (no /Resources
// indirection for the box itself).
const MEDIABOX_RE = /\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/;

function firstMediaBox(buf: Buffer): { width: number; height: number } {
  // PDF data through the first MediaBox is ASCII; scan a Latin-1 window.
  const m = MEDIABOX_RE.exec(buf.toString('latin1'));
  if (!m) return { width: 0, height: 0 };
  return {
    width: Number(m[3]) - Number(m[1]),
    height: Number(m[4]) - Number(m[2]),
  };
}
