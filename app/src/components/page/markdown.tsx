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
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import { useReaderLangHref } from '@/lib/corpus/use-corpus-href';
import { remarkCallouts } from '@/components/page/markdown-callouts';
import { remarkVaultLinks } from '@/components/page/markdown-vault-links';
import {
  escapeCurrencyDollars, mermaidSource, promoteDisplayMath,
} from '@/components/page/markdown-helpers';
import styles from '@/components/page/ChatMarkdown.module.css';

// mermaid 是 ~600KB；lazy import 不进 SSR bundle。
const MermaidBlock = lazy(async () => {
  const mod = await import('@/components/page/MermaidBlock');
  return { default: mod.MermaidBlock };
});

// TikZ:重 WASM 在服务端(node-tikzjax)；client 只 fetch SVG,组件本身轻,lazy 省首屏。
const TikZBlock = lazy(async () => {
  const mod = await import('@/components/page/TikZBlock');
  return { default: mod.TikZBlock };
});

// standmeet-widget:沙箱 iframe;client-only mount(seo:false),lazy。
const WidgetBlock = lazy(async () => {
  const mod = await import('@/components/page/WidgetBlock');
  return { default: mod.WidgetBlock };
});

// standmeet-html:owner 预烤的静态 HTML(sanitize 后渲);sanitize-html 只在有此块时 lazy 加载。
const StaticHtmlBlock = lazy(async () => {
  const mod = await import('@/components/page/StaticHtmlBlock');
  return { default: mod.StaticHtmlBlock };
});

// BLOCK_RENDERERS —— fenced lang → 特殊渲染块。查表避免多分支(cyclomatic)。
const BLOCK_RENDERERS: Record<string, (source: string) => React.ReactElement> = {
  mermaid: (source) => <LazyBlock kind="mermaid" source={source}><MermaidBlock source={source} /></LazyBlock>,
  tikz: (source) => <LazyBlock kind="tikz" source={source}><TikZBlock source={source} /></LazyBlock>,
  'standmeet-widget': (source) => (
    <LazyBlock kind="widget" source={source}><WidgetBlock source={source} /></LazyBlock>
  ),
  'standmeet-html': (source) => (
    <LazyBlock kind="static-html" source={source}><StaticHtmlBlock source={source} /></LazyBlock>
  ),
};

// schema —— defaultSchema + 允许 className (KaTeX 注的 .katex / .katex-display)。
// CORPUS_REMARK_PLUGINS —— **渲染 owner 语料的那一套，只有这一份。**
//
// 以前 writings 文章页自己配了第二份（只有 gfm + math），于是两个面对同一批 markdown
// 给出两种结果，而差异只有在恰好撞上的那一篇上才看得见。
//
// `remarkCjkFriendly` 就是那样撞出来的：CommonMark 的分隔符两侧规则里，闭合的 `**`
// 要求「右侧贴合」—— 前面不能是标点，除非后面是空白或标点。中文里
// `**……卖广告。**这句话` 前面正好是 `。`、后面是汉字，于是闭合不成立，整段退化成字面星号，
// 屏幕上是 `**我们不拿你的访客数据卖广告。**`。作者在 Obsidian 里看到的是粗体 ——
// **产品渲染的是 owner 的 vault，两边不一致的时候错的是产品。**
//
// 这个不能自己写几行绕过去：星号在解析阶段就已经是文本了，要改的是 micromark 的
// attention 分词器，而这个插件实现的正是 CommonMark 那份 CJK 扩展。
export const CORPUS_REMARK_PLUGINS = [
  remarkGfm, remarkMath, remarkCjkFriendly, remarkCallouts, remarkVaultLinks,
];

const SAFE_SCHEMA: typeof defaultSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'className', 'data-callout'],
    code: [...(defaultSchema.attributes?.code ?? []), 'className'],
  },
};

interface CodeProps {
  className?: string;
  children?: React.ReactNode;
}

function MarkdownCode(props: CodeProps): React.ReactElement {
  const className = props.className ?? '';
  return renderCodeBlock(className, mermaidSource(props.children))
    ?? <code className={className}>{props.children}</code>;
}

// renderCodeBlock —— fenced 代码块的特殊渲染(mermaid / tikz / widget),否则 null 回退普通 code。
function renderCodeBlock(className: string, source: string): React.ReactElement | null {
  const renderer = BLOCK_RENDERERS[className.replace(/^language-/, '')];
  return renderer ? renderer(source) : null;
}

// LazyBlock —— Suspense + loading fallback 包一个 lazy 渲染块(mermaid / tikz 共用)。
function LazyBlock(
  { kind, source, children }: { kind: string; source: string; children: React.ReactNode },
): React.ReactElement {
  return (
    <Suspense fallback={<pre data-testid={`${kind}-loading`}>{source}</pre>}>
      {children}
    </Suspense>
  );
}

// variant —— 'chat'(默认)是聊天答复的紧凑排版;'article' 给 wiki / writing
// 长文阅读用编辑级排版(p 21/1.65、h2 serif 26、blockquote 24 italic accent),
// 见 ChatMarkdown.module.css 的 .article 修饰。两种共用同一条 markdown 管线。
type MarkdownVariant = 'chat' | 'article';

// CorpusAnchor —— 正文里的链接。vault 的 `[[X]]` 由后端改写成 `/wiki/<path>` 才进
// markdown,不经 corpusHref —— 所以读者选的语言在**正文里那些链接**上会掉,而那正是
// 读着读着点得最多的一种。这里给它们接上;外链一个字不动。
function CorpusAnchor(props: React.ComponentPropsWithoutRef<'a'>): React.ReactElement {
  const withLang = useReaderLangHref();
  const { href, ...rest } = props;
  return <a href={withLang(href ?? '')} {...rest} />;
}

export function ChatMarkdown(
  { source, variant = 'chat' }: { source: string; variant?: MarkdownVariant },
): React.ReactElement {
  // styles.body scope —— ChatMarkdown.module.css 里给 table / pre / code /
  // blockquote / a / ul 配 design palette (warm cream + ink + vermillion)。
  const cls = variant === 'article'
    ? `${styles['body']} ${styles['article']}`
    : styles['body'];
  return (
    <div className={cls}>
      <ReactMarkdown
        remarkPlugins={CORPUS_REMARK_PLUGINS}
        // ORDER MATTERS (F-R-3): sanitize FIRST, then katex. rehype-katex emits dozens of spans
        // whose LAYOUT lives in inline `style` (strut heights, vlist offsets, sub/sup positions).
        // rehype-sanitize strips `style` — so if it runs AFTER katex it guts every equation
        // (struts collapse to 0 → ∑/sub/sup overflow and overlap). Sanitizing the USER content
        // first, then letting the TRUSTED katex render into it, keeps katex's styles intact while
        // still stripping any <script> the LLM/skill output carried. This is katex's own
        // recommended sanitize order — do not swap it back.
        rehypePlugins={[[rehypeSanitize, SAFE_SCHEMA], rehypeKatex]}
        components={{ code: MarkdownCode, a: CorpusAnchor }}
      >
        {escapeCurrencyDollars(promoteDisplayMath(source))}
      </ReactMarkdown>
    </div>
  );
}
