// tikz.ts —— TikZ 源码 → SVG 的 server-side usecase(node-tikzjax = obsidian-tikzjax 同引擎)。
// **只在服务端 import**(route.ts);重 WASM TeX 引擎不进客户端 bundle。

import tex2svg from 'node-tikzjax';
import { z } from 'zod';

const TikzReqSchema = z.object({ source: z.string().min(1).max(20_000) });

export interface TikzResult {
  status: number;
  payload: { svg?: string; error?: string };
}

// renderTikz —— 校验 + 渲染;返回 status + payload,controller 直接透传。
export async function renderTikz(raw: unknown): Promise<TikzResult> {
  const parsed = TikzReqSchema.safeParse(raw);
  return parsed.success
    ? renderValidated(parsed.data.source)
    : Promise.resolve({ status: 400, payload: { error: 'invalid source' } });
}

const RENDER_TIMEOUT_MS = 25_000;

// wrapDocument —— reader 里的 tikz 块是 `\begin{tikzpicture}…`;node-tikzjax 要整个
// `\begin{document}…\end{document}`(它给 documentclass/preamble)。已是全文档就不重复包。
function wrapDocument(source: string): string {
  return source.includes('\\begin{document}')
    ? source
    : `\\begin{document}\n${source}\n\\end{document}`;
}

function renderValidated(source: string): Promise<TikzResult> {
  const rendered = tex2svg(wrapDocument(source), { showConsole: false })
    .then((svg): TikzResult => ({ status: 200, payload: { svg } }));
  return Promise.race([rendered, timeout(RENDER_TIMEOUT_MS)])
    .catch((e: unknown): TikzResult => ({
      status: 422,
      payload: { error: e instanceof Error ? e.message : 'render failed' },
    }));
}

// timeout —— TeX 引擎冷启动/资产缺失时别让请求挂死;超时降级成 error(client 显示源码)。
function timeout(ms: number): Promise<TikzResult> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error('tikz render timeout')), ms);
  });
}
