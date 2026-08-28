// TikZBlock —— ` ```tikz ` 块的客户端渲染。源码 POST 到 /render-tikz(server 用 node-tikzjax
// = obsidian-tikzjax 同引擎渲成 SVG)→ inject。重 WASM 留服务端,客户端只拿 SVG。
// pattern 同 MermaidBlock(loading/error/ok 三态,presentation 只 read state,ternary 分支)。

'use client';

import { useEffect, useState } from 'react';
import { z } from 'zod';

import { useDiagramDiagnostics } from '@/components/page/diagram-diagnostics';
import { logger } from '@/lib/logger';

type TikZState =
  | { kind: 'loading' }
  | { kind: 'ok'; svg: string }
  | { kind: 'error' };

const TikzResSchema = z.object({ svg: z.string().optional() });

export function TikZBlock({ source }: { source: string }): React.ReactElement {
  const [state, setState] = useState<TikZState>({ kind: 'loading' });

  useEffect(() => {
    const guard = { cancelled: false };
    void fetchTikz(source).then((s) => (guard.cancelled ? undefined : setState(s)));
    return () => { guard.cancelled = true; };
  }, [source]);

  return state.kind === 'ok'
    ? (
      // 图在自己那一格里**居中**,而且不许撑破正文列:SVG 带着 TeX 排出来的固定
      // width/height,窄一点的列上它会直接顶出去。max-w-full + h-auto 让它按比例缩,
      // 缩到头还不够就在这一格里横向滚,不影响页面本身。
      <div
        data-testid="tikz-svg"
        className="my-6 flex justify-center overflow-x-auto [&_svg]:max-w-full [&_svg]:h-auto"
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
    )
    : <PendingDiagram source={source} kind={state.kind} />;
}

// PendingDiagram —— 还没渲出来的那一格。**不许把 LaTeX 源码印给读者**:图只是补充,
// 正文本来就得自己站得住,而 `\begin{tikzpicture}` 不是产品说的话。这跟 MermaidBlock 的
// FailedDiagram 是同一个决定 —— owner 看得见诊断,访客什么都看不见 —— tikz 这边当初漏了,
// 于是渲染一失败读者就吃到一整段 LaTeX。
//
// loading 也归这里:引擎串行之后,一页多图时排在后面的要等上几秒,那几秒更不能是源码。
function PendingDiagram(
  { source, kind }: { source: string; kind: 'loading' | 'error' },
): React.ReactElement | null {
  const diagnostics = useDiagramDiagnostics();
  const failed = kind === 'error';
  useEffect(() => {
    void (failed && logger.error('tikz render failed', { source }));
  }, [failed, source]);
  return failed
    ? diagnostics ? <pre data-testid="tikz-error" className="text-(--color-muted)">{source}</pre> : null
    : <div data-testid="tikz-loading" className="my-6 h-24 animate-pulse bg-(--color-rule)/30" />;
}

function fetchTikz(source: string): Promise<TikZState> {
  return fetch('/render-tikz', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source }),
  })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error('http'))))
    .then((data) => TikzResSchema.parse(data))
    .then((d): TikZState => (d.svg === undefined ? { kind: 'error' } : { kind: 'ok', svg: d.svg }))
    .catch((): TikZState => ({ kind: 'error' }));
}
