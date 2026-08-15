// MermaidBlock —— mermaid 客户端渲染。lazy 加载 (~600KB)；mermaid
// 初始化跟 React lifecycle 解耦 (effect 里同步触发)。
//
// 设计选择：每个 block 独立 mermaid.render 调用拿 SVG 字符串，dangerously
// inject (mermaid 自己输出受信 SVG)。Suspense fallback 在父层。

'use client';

import { useEffect, useRef, useState } from 'react';

import { useDiagramDiagnostics } from '@/components/page/diagram-diagnostics';
import { logger } from '@/lib/logger';
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
    ? <FailedDiagram source={source} message={error} />
    : <div data-testid="mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} />;
}

// FailedDiagram —— 编译不过的那一格。**给谁看，决定它长什么样**（见 diagram-diagnostics）：
// owner 要那句报错（模型画错了，他得看得见），访客什么都不该看见 —— 图只是补充，
// 正文本来就得自己站得住，而 mermaid 库的内部措辞不是产品说的话。
//
// 访客那一档不是「静默」：失败照样记一条日志，闸门只挡显示，不挡问题被知道。
function FailedDiagram(
  { source, message }: { source: string; message: string },
): React.ReactElement | null {
  const diagnostics = useDiagramDiagnostics();
  logger.error('mermaid compile failed', { message, source });
  return diagnostics
    ? <pre data-testid="mermaid-error">{message}</pre>
    : null;
}
