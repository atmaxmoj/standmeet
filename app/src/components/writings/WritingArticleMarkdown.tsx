// WritingArticleMarkdown —— react-markdown 的 component override 集合。
// 从 WritingArticle 拆出来守 350-line cap。所有样式落在
// WritingArticleMarkdown.module.css —— 这个文件只组装 element + 处理 inline /
// fence code 分流 + 外链 rel 注入，不再 carry typography 数字。
//
// markdown body 整体挂 styles.body class（caller 由 WritingArticle 提供）；
// 描述性 selectors `.body h1` / `.body p` 等接管字体 / 间距。

import type { ReactNode } from 'react';

import styles from '@/components/writings/WritingArticleMarkdown.module.css';

export { styles as markdownStyles };

// markdownComponents —— 喂给 <Markdown components={...}>。WritingArticle 在调
// react-markdown 前已把 `standmeet-asset:<id>` URI expand 成 https presigned
// URL（react-markdown 默认 urlTransform 会 strip 非标准 scheme）。这里只关
// 心 element 形态，不关心 src 解析；样式都由 module CSS descendant 规则接管。
// XSS 默认安全（react-markdown 默认 escape raw HTML）。
export const markdownComponents = {
  table: Table,
  code: CodeInlineOrBlock,
  a: Anchor,
  img: Img,
};

interface CodeProps { className?: string; children?: ReactNode }

// CodeInlineOrBlock —— react-markdown 给 `inline code` 和 ```fence``` 都用
// <code>；带 language-* className = fence 上下文，需要保留好让 syntax
// highlighter 之类未来工具能识别。
function CodeInlineOrBlock({ className, children }: CodeProps) {
  return isFenceClass(className)
    ? <code className={className}>{children}</code>
    : <code>{children}</code>;
}

function isFenceClass(className?: string): boolean {
  return (className ?? '').startsWith('language-');
}

interface AnchorProps { href?: string; children?: ReactNode }

// Anchor —— 外链强制 noopener noreferrer + target=_blank；内链不动。
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

// Table —— 包一层 .tableWrap 给宽表横向滚（mobile），内层 <table> 走
// module CSS 的 .body table descendant selector。
function Table({ children }: { children?: ReactNode }) {
  return (
    <div className={styles.tableWrap}>
      <table>{children}</table>
    </div>
  );
}
