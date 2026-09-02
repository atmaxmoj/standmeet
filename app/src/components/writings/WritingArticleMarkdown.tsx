// WritingArticleMarkdown —— the react-markdown component override set.
// Split out of WritingArticle to stay under the 350-line cap. All styling
// lives in WritingArticleMarkdown.module.css — this file only assembles
// elements + routes inline vs. fence code + injects external-link rel,
// and no longer carries typography numbers.
//
// The markdown body gets the styles.body class as a whole (the caller,
// WritingArticle, supplies it); descriptive selectors like `.body h1` /
// `.body p` take over font / spacing from there.
//
// I.2: a ```` ```mermaid ```` fence → lazy MermaidBlock (same set used by
// chat rendering); math goes through remarkMath + rehypeKatex (plugin added
// in WritingArticle).

'use client';

import { lazy, Suspense, type ReactNode } from 'react';

import { isMermaidCode, mermaidSource } from '@/components/page/markdown-helpers';
import styles from '@/components/writings/WritingArticleMarkdown.module.css';

const MermaidBlock = lazy(async () => {
  const mod = await import('@/components/page/MermaidBlock');
  return { default: mod.MermaidBlock };
});

export { styles as markdownStyles };

// markdownComponents —— fed to <Markdown components={...}>. WritingArticle
// already expands `standmeet-asset:<id>` URIs to https presigned URLs before
// calling react-markdown (react-markdown's default urlTransform strips
// non-standard schemes). This file only cares about element shape, not src
// resolution; all styling is taken over by module CSS descendant rules.
// XSS-safe by default (react-markdown escapes raw HTML by default).
export const markdownComponents = {
  table: Table,
  code: CodeInlineOrBlock,
  a: Anchor,
  img: Img,
};

interface CodeProps { className?: string; children?: ReactNode }

// CodeInlineOrBlock —— react-markdown uses <code> for both `inline code`
// and ```fence``` blocks; a language-* className means fence context, and
// needs to be preserved so a future tool like a syntax highlighter can
// recognize it.
// I.2: language-mermaid goes through lazy MermaidBlock, rendering SVG.
function CodeInlineOrBlock({ className, children }: CodeProps) {
  const cls = className ?? '';
  return isMermaidCode(cls)
    ? <MermaidCode>{children}</MermaidCode>
    : <CodeFence cls={cls}>{children}</CodeFence>;
}

function MermaidCode({ children }: { children?: ReactNode }) {
  const source = mermaidSource(children);
  return (
    <Suspense fallback={<pre data-testid="mermaid-loading">{source}</pre>}>
      <MermaidBlock source={source} />
    </Suspense>
  );
}

function CodeFence({ cls, children }: { cls: string; children?: ReactNode }) {
  return isFenceClass(cls)
    ? <code className={cls}>{children}</code>
    : <code>{children}</code>;
}

function isFenceClass(className?: string): boolean {
  return (className ?? '').startsWith('language-');
}

interface AnchorProps { href?: string; children?: ReactNode }

// Anchor —— external links force noopener noreferrer + target=_blank;
// internal links are left untouched.
function Anchor({ href, children }: AnchorProps) {
  const isExternal = !!href && /^https?:\/\//i.test(href);
  return (
    <a
      href={href}
      {...(isExternal ? { rel: 'noopener noreferrer', target: '_blank' } : {})}
    >
      {children}
    </a>
  );
}

interface ImgProps { src?: string | Blob; alt?: string }

function Img({ src, alt }: ImgProps) {
  return <img src={typeof src === 'string' ? src : undefined} alt={alt ?? ''} />;
}

// Table —— wraps a .tableWrap around it so wide tables can scroll
// horizontally (mobile); the inner <table> goes through the module CSS's
// .body table descendant selector.
function Table({ children }: { children?: ReactNode }) {
  return (
    <div className={styles.tableWrap}>
      <table>{children}</table>
    </div>
  );
}
