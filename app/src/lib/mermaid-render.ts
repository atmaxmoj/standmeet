// mermaid-render.ts —— dynamic import mermaid + render to SVG。
// 拆出 .ts 让 MermaidBlock.tsx 不带 try/catch / if 分支 (presentation
// 层只 read state)。

export type MermaidRenderResult =
  | { kind: 'ok'; svg: string }
  | { kind: 'error'; message: string };

let initialized = false;

export async function renderMermaidSVG(
  id: string, source: string,
): Promise<MermaidRenderResult> {
  try {
    const mermaid = await import('mermaid');
    if (!initialized) {
      mermaid.default.initialize({ startOnLoad: false, theme: 'default' });
      initialized = true;
    }
    const { svg } = await mermaid.default.render(id, source);
    return { kind: 'ok', svg };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}
