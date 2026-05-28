// pdf-inspect —— PDF assertion helpers for resume / application specs.
//
// 关键测点：
//   1. extractPDFText —— pdf-parse 解 PDF 全文（断言文字层存在，不是 image-only）
//   2. extractFirstQR —— 解 PDF 里的 QR 图像，断言 ≡ 预期 URL

import { PDFParse } from 'pdf-parse';
import jsQR from 'jsqr';
import { Jimp } from 'jimp';

export interface PDFTextInfo {
  text: string;
  pages: number;
}

export async function extractPDFText(pdf: Buffer): Promise<PDFTextInfo> {
  const parser = new PDFParse({ data: new Uint8Array(pdf) });
  try {
    const result = await parser.getText();
    return { text: result.text, pages: result.total };
  } finally {
    await parser.destroy();
  }
}

// extractFirstQR —— PDF 里嵌的 QR 图像通过 gopdf 写成 PDF XObject 流（zlib
// 压缩的 raw pixel bytes，不是 PNG 原貌）。用 pdf-parse 的 getImage 提取，
// 拿到 dataUrl (base64 PNG) → Jimp 解码 → jsQR 扫。
//
// 第一个非零尺寸的图像就是 QR（resume render 只嵌一张图，QR 本体）。
export async function extractFirstQR(pdf: Buffer): Promise<string | null> {
  const png = await extractFirstImagePNG(pdf);
  if (!png) return null;
  const img = await Jimp.read(png);
  const { width, height } = img.bitmap;
  const result = jsQR(new Uint8ClampedArray(img.bitmap.data), width, height);
  return result?.data ?? null;
}

async function extractFirstImagePNG(pdf: Buffer): Promise<Buffer | null> {
  const parser = new PDFParse({
    data: new Uint8Array(pdf),
    includeImageBuffer: true,
    includeImageDataUrl: true,
  });
  try {
    const result = await parser.getImage();
    for (const page of result.pages) {
      for (const im of page.images) {
        if (im.width === 0 || im.height === 0) continue;
        const png = pickPNGBytes(im);
        if (png) return png;
      }
    }
    return null;
  } finally {
    await parser.destroy();
  }
}

interface ImageLike {
  data?: Uint8Array;
  dataUrl?: string;
  width: number;
  height: number;
}

function pickPNGBytes(im: ImageLike): Buffer | null {
  // Prefer dataUrl PNG (decodable by Jimp directly).
  if (im.dataUrl?.startsWith('data:image/png;base64,')) {
    return Buffer.from(im.dataUrl.slice('data:image/png;base64,'.length), 'base64');
  }
  // Fallback: raw data bytes — only useful if they actually start with PNG sig.
  if (im.data) {
    const buf = Buffer.from(im.data);
    if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) return buf;
  }
  return null;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
