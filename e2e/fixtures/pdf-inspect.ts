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

export interface PDFInfo {
  pages: number;
  text: string;
  pageWidthPt: number;
  pageHeightPt: number;
}

interface PdfTextItem { str?: string }
interface PdfPage { getTextContent(): Promise<{ items: PdfTextItem[] }> }
interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
}
interface PdfLoadingTask { promise: Promise<PdfDoc>; destroy(): Promise<void> }
interface PdfjsModule {
  getDocument(src: { data: Uint8Array; isEvalSupported?: boolean; useSystemFonts?: boolean }):
  PdfLoadingTask;
}

export async function inspectPDF(buf: Buffer): Promise<PDFInfo> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs') as unknown as PdfjsModule;
  // In pdfjs-dist@6 destroy() lives on the loading task, not the document proxy.
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: true,
  });
  const doc = await task.promise;
  try {
    const parts: string[] = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      parts.push(content.items.map((it) => it.str ?? '').join(' '));
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
