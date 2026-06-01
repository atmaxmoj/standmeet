// markdown.tsx —— chat 渲染的统一 markdown 入口。
//
// 装备：remark-gfm (table/strikethrough/autolink) + remark-math +
// rehype-katex (LaTeX) + rehype-sanitize (替代 rehype-raw 防 XSS)。
// Mermaid 块单独识别 (```mermaid) 通过 component override 动态渲。
//
// rehype-sanitize 用 defaultSchema 但额外允许 className (KaTeX 需要)。
// 不开 rehype-raw 让原始 HTML 全部被 sanitize 兜底 (mock provider /
// owner skill 输出里夹 <script> 会被剔除)。

'use client';

import { lazy, Suspense } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import {
  isMermaidCode, mermaidSource,
} from '@/components/page/markdown-helpers';
import styles from '@/components/page/ChatMarkdown.module.css';

// mermaid 是 ~600KB；lazy import 不进 SSR bundle。
const MermaidBlock = lazy(async () => {
  const mod = await import('@/components/page/MermaidBlock');
  return { default: mod.MermaidBlock };
});

// schema —— defaultSchema + 允许 className (KaTeX 注的 .katex / .katex-display)。
const SAFE_SCHEMA: typeof defaultSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'className'],
    code: [...(defaultSchema.attributes?.code ?? []), 'className'],
  },
};

interface CodeProps {
  className?: string;
  children?: React.ReactNode;
}

function MarkdownCode(props: CodeProps): React.ReactElement {
  const className = props.className ?? '';
  const source = mermaidSource(props.children);
  return isMermaidCode(className) ? (
    <Suspense fallback={<pre data-testid="mermaid-loading">{source}</pre>}>
      <MermaidBlock source={source} />
    </Suspense>
  ) : <code className={className}>{props.children}</code>;
}

export function ChatMarkdown({ source }: { source: string }): React.ReactElement {
  // styles.body scope —— ChatMarkdown.module.css 里给 table / pre / code /
  // blockquote / a / ul 配 design palette (warm cream + ink + vermillion)。
  return (
    <div className={styles['body']}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, [rehypeSanitize, SAFE_SCHEMA]]}
        components={{ code: MarkdownCode }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
