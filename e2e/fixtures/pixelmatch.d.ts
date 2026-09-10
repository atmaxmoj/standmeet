// Ambient types for pixelmatch v6, which ships none. The single default export compares two RGBA
// buffers of the same W×H and returns the count of differing pixels.
declare module 'pixelmatch' {
  export default function pixelmatch(
    img1: Uint8Array | Buffer,
    img2: Uint8Array | Buffer,
    output: Uint8Array | Buffer | null,
    width: number,
    height: number,
    options?: { threshold?: number; includeAA?: boolean },
  ): number;
}
