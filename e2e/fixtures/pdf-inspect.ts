// pdf-inspect.ts —— pdf-parse v2 wrapper for spec assertions on the
// gotenberg-rendered resume PDF. Covers what we'd otherwise eyeball:
//   - number of pages
//   - page dimensions in PDF points
//   - the extracted text layer (proves not image-only + content right)
//
// pdf-parse v2's getInfo / getPageText don't surface page MediaBox in
// 2.4.5, so we read the first /MediaBox directly from the raw PDF stream.
// That's the canonical "page size in PDF points" definition anyway.

import { PDFParse } from 'pdf-parse';

export interface PDFInfo {
  pages: number;
  text: string;
  pageWidthPt: number;
  pageHeightPt: number;
}

export async function inspectPDF(buf: Buffer): Promise<PDFInfo> {
  const parser = new PDFParse({ data: buf });
  const textRes = await parser.getText();
  const dims = firstMediaBox(buf);
  return {
    pages: textRes.total ?? textRes.pages?.length ?? 0,
    text: textRes.text ?? '',
    pageWidthPt: dims.width,
    pageHeightPt: dims.height,
  };
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
