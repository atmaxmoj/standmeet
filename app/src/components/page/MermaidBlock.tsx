// MermaidBlock —— mermaid 客户端渲染。lazy 加载 (~600KB)；mermaid
// 初始化跟 React lifecycle 解耦 (effect 里同步触发)。
//
// 设计选择：每个 block 独立 mermaid.render 调用拿 SVG 字符串，dangerously
// inject (mermaid 自己输出受信 SVG)。Suspense fallback 在父层。

'use client';

import { useEffect, useRef, useState } from 'react';

import { renderMermaidSVG, type MermaidRenderResult } from '@/lib/mermaid-render';

interface MermaidBlockProps {
  source: string;
}

let mermaidIdCounter = 0;
function nextID(): string {
  mermaidIdCounter += 1;
  return `mermaid-${mermaidIdCounter}`;
}

function renderState(result: MermaidRenderResult | null): {
  svg: string;
  error: string | null;
} {
  return result === null ? { svg: '', error: null }
    : result.kind === 'ok' ? { svg: result.svg, error: null }
    : { svg: '', error: result.message };
}

export function MermaidBlock({ source }: MermaidBlockProps): React.ReactElement {
  const [result, setResult] = useState<MermaidRenderResult | null>(null);
  const idRef = useRef<string>(nextID());

  useEffect(() => {
    const guard = { cancelled: false };
    void renderMermaidSVG(idRef.current, source).then(
      (r) => guard.cancelled ? undefined : setResult(r),
    );
    return () => { guard.cancelled = true; };
  }, [source]);

  const { svg, error } = renderState(result);
  return error !== null
    ? <pre data-testid="mermaid-error" className="text-red-600">{error}</pre>
    : <div data-testid="mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} />;
}
