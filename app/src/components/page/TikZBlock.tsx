// TikZBlock —— ` ```tikz ` 块的客户端渲染。源码 POST 到 /render-tikz(server 用 node-tikzjax
// = obsidian-tikzjax 同引擎渲成 SVG)→ inject。重 WASM 留服务端,客户端只拿 SVG。
// pattern 同 MermaidBlock(loading/error/ok 三态,presentation 只 read state,ternary 分支)。

'use client';

import { useEffect, useState } from 'react';
import { z } from 'zod';

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
    ? <div data-testid="tikz-svg" dangerouslySetInnerHTML={{ __html: state.svg }} />
    : (
      <pre
        data-testid={state.kind === 'error' ? 'tikz-error' : 'tikz-loading'}
        className="text-(--color-muted)"
      >{source}</pre>
    );
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
