// BlogArticleMarkdown —— react-markdown 的 component override 集合。
// 从 BlogArticle 拆出来守 350-line cap。每个 element 套 standmeet 字体 /
// 字号 / 间距，pixel-for-pixel 接住 Stripe-Press 风密度 (680 单栏 / 21px
// body / 1.65 行高)。

import type { CSSProperties, ReactNode } from 'react';

// markdownComponents —— 喂给 <Markdown components={...}>。BlogArticle 在调
// react-markdown 前已把 `standmeet-asset:<id>` URI expand 成 https presigned
// URL（react-markdown 默认 urlTransform 会 strip 非标准 scheme）。这里只关
// 心样式不关心 src 解析。XSS 默认安全（react-markdown 默认 escape raw HTML）。
export const markdownComponents = {
  h1: H1, h2: H2, h3: H3,
  p: Para,
  blockquote: Quote,
  ul: UL, ol: OL, li: LI,
  code: CodeInlineOrBlock,
  pre: Pre,
  a: Anchor,
  img: Img,
  hr: HR,
  table: Table, thead: THead, tbody: TBody, tr: TR, th: TH, td: TD,
  strong: Strong, em: Em, del: Del,
};

function H1({ children }: { children?: ReactNode }) {
  return (
    <h1 className="font-serif" style={{
      fontSize: '36px', fontWeight: 500, letterSpacing: '-0.015em',
      margin: '2.6em 0 0.6em', lineHeight: 1.2,
    }}>{children}</h1>
  );
}

function H2({ children }: { children?: ReactNode }) {
  return (
    <h2 className="font-serif" style={{
      fontSize: '28px', fontWeight: 500, letterSpacing: '-0.012em',
      margin: '2.6em 0 0.6em', lineHeight: 1.25,
    }}>{children}</h2>
  );
}

function H3({ children }: { children?: ReactNode }) {
  return (
    <h3 className="font-serif" style={{
      fontSize: '22px', fontWeight: 500, letterSpacing: '-0.008em',
      margin: '2.2em 0 0.5em', lineHeight: 1.3,
    }}>{children}</h3>
  );
}

function Para({ children }: { children?: ReactNode }) {
  return (
    <p style={{ fontSize: '21px', lineHeight: 1.65, marginBottom: '1.4em' }}>
      {children}
    </p>
  );
}

function Quote({ children }: { children?: ReactNode }) {
  return (
    <blockquote className="italic" style={{
      fontSize: '23px', lineHeight: 1.45, letterSpacing: '-0.006em',
      color: 'var(--color-ink)', margin: '2em -28px',
      padding: '4px 28px',
      borderLeft: '3px solid var(--color-accent)',
    }}>{children}</blockquote>
  );
}

function UL({ children }: { children?: ReactNode }) {
  return (
    <ul className="list-disc" style={{
      fontSize: '21px', lineHeight: 1.6, marginBottom: '1.4em',
      paddingLeft: '1.6em',
    }}>{children}</ul>
  );
}

function OL({ children }: { children?: ReactNode }) {
  return (
    <ol className="list-decimal" style={{
      fontSize: '21px', lineHeight: 1.6, marginBottom: '1.4em',
      paddingLeft: '1.6em',
    }}>{children}</ol>
  );
}

function LI({ children }: { children?: ReactNode }) {
  return <li style={{ marginBottom: '0.5em' }}>{children}</li>;
}

interface CodeProps { className?: string; children?: ReactNode }

// CodeInlineOrBlock —— react-markdown 给 `inline code` 和 ```fence``` 都用
// <code>；带 language-* className = fence 上下文。
function CodeInlineOrBlock({ className, children }: CodeProps) {
  return isFenceClass(className)
    ? <FenceCode className={className}>{children}</FenceCode>
    : <InlineCode>{children}</InlineCode>;
}

function isFenceClass(className?: string): boolean {
  return (className ?? '').startsWith('language-');
}

function FenceCode({ className, children }: CodeProps) {
  return <code className={(className ?? '') + ' mono'} style={fenceStyle}>{children}</code>;
}

function InlineCode({ children }: { children?: ReactNode }) {
  return <code className="mono" style={inlineCodeStyle}>{children}</code>;
}

const inlineCodeStyle: CSSProperties = {
  fontSize: '0.9em',
  background: 'color-mix(in srgb, var(--color-ink) 8%, transparent)',
  padding: '0.1em 0.35em',
  borderRadius: '2px',
};

const fenceStyle: CSSProperties = {
  fontSize: '15px',
  lineHeight: 1.55,
  display: 'block',
};

function Pre({ children }: { children?: ReactNode }) {
  return (
    <pre className="mono" style={{
      background: 'color-mix(in srgb, var(--color-ink) 6%, transparent)',
      border: '1px solid var(--color-rule)',
      padding: '1em 1.2em',
      overflow: 'auto',
      margin: '1.6em 0',
    }}>{children}</pre>
  );
}

interface AnchorProps { href?: string; children?: ReactNode }

function Anchor({ href, children }: AnchorProps) {
  const isExternal = !!href && /^https?:\/\//i.test(href);
  return (
    <a
      href={href}
      {...(isExternal ? { rel: 'noopener noreferrer', target: '_blank' } : {})}
      style={{ color: 'var(--color-accent)', textDecoration: 'underline' }}
    >
      {children}
    </a>
  );
}

interface ImgProps { src?: string | Blob; alt?: string }

function Img({ src, alt }: ImgProps) {
  return (
    <img
      src={typeof src === 'string' ? src : undefined}
      alt={alt ?? ''}
      style={{ maxWidth: '100%', height: 'auto', margin: '1.8em 0' }}
    />
  );
}

function HR() {
  return (
    <hr style={{
      border: 'none',
      borderTop: '1px solid var(--color-rule)',
      margin: '2.4em 0',
    }} />
  );
}

function Table({ children }: { children?: ReactNode }) {
  return (
    <div style={{ overflowX: 'auto', margin: '1.6em 0' }}>
      <table style={{
        width: '100%', borderCollapse: 'collapse',
        fontSize: '16px', lineHeight: 1.5,
      }}>{children}</table>
    </div>
  );
}

function THead({ children }: { children?: ReactNode }) {
  return <thead style={{ borderBottom: '2px solid var(--color-ink)' }}>{children}</thead>;
}

function TBody({ children }: { children?: ReactNode }) { return <tbody>{children}</tbody>; }

function TR({ children }: { children?: ReactNode }) {
  return <tr style={{ borderBottom: '1px solid var(--color-rule)' }}>{children}</tr>;
}

function TH({ children }: { children?: ReactNode }) {
  return (
    <th className="mono" style={{
      textAlign: 'left', padding: '0.6em 0.9em',
      fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em',
      color: 'var(--color-muted)', fontWeight: 500,
    }}>{children}</th>
  );
}

function TD({ children }: { children?: ReactNode }) {
  return <td style={{ padding: '0.6em 0.9em', verticalAlign: 'top' }}>{children}</td>;
}

function Strong({ children }: { children?: ReactNode }) {
  return <strong style={{ fontWeight: 600 }}>{children}</strong>;
}

function Em({ children }: { children?: ReactNode }) {
  return <em style={{ fontStyle: 'italic' }}>{children}</em>;
}

function Del({ children }: { children?: ReactNode }) {
  return <del style={{ textDecoration: 'line-through', opacity: 0.6 }}>{children}</del>;
}
