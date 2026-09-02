// markdown.tsx —— the unified markdown entry point for chat rendering.
//
// Stack: remark-gfm (table/strikethrough/autolink) + remark-math +
// rehype-katex (LaTeX) + rehype-sanitize (replaces rehype-raw to prevent
// XSS). Mermaid blocks are identified separately (```mermaid) and rendered
// dynamically via a component override.
//
// rehype-sanitize uses defaultSchema plus an extra allowance for className
// (needed by KaTeX). rehype-raw is left off so all raw HTML falls through
// sanitize's net (a <script> tucked into a mock provider's / owner skill's
// output gets stripped).

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

// mermaid is ~600KB; the lazy import keeps it out of the SSR bundle.
const MermaidBlock = lazy(async () => {
  const mod = await import('@/components/page/MermaidBlock');
  return { default: mod.MermaidBlock };
});

// TikZ: the heavy WASM stays server-side (node-tikzjax); the client only
// fetches the SVG, so the component itself is light — lazy just saves first-paint weight.
const TikZBlock = lazy(async () => {
  const mod = await import('@/components/page/TikZBlock');
  return { default: mod.TikZBlock };
});

// standmeet-widget: a sandboxed iframe; client-only mount (seo:false), lazy.
const WidgetBlock = lazy(async () => {
  const mod = await import('@/components/page/WidgetBlock');
  return { default: mod.WidgetBlock };
});

// standmeet-html: owner-prebaked static HTML (rendered after sanitize);
// sanitize-html is lazy-loaded only when this block is actually present.
const StaticHtmlBlock = lazy(async () => {
  const mod = await import('@/components/page/StaticHtmlBlock');
  return { default: mod.StaticHtmlBlock };
});

// BLOCK_RENDERERS —— fenced lang → special-case render block. A lookup table avoids a branch pile-up (cyclomatic).
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

// schema —— defaultSchema plus className allowed (needed for the .katex / .katex-display KaTeX annotates elements with).
// CORPUS_REMARK_PLUGINS —— **the one and only set for rendering owner corpus content.**
//
// The writings article page used to configure a second set of its own (just
// gfm + math), so the same markdown produced two different results
// depending which page rendered it, and the difference was only visible on
// whichever article happened to collide with it.
//
// `remarkCjkFriendly` is exactly that kind of collision: in CommonMark's
// delimiter-run rules, a closing `**` requires "right-flanking" — the
// character before it can't be punctuation unless what follows is
// whitespace or punctuation. In Chinese, `**……卖广告。**这句话` has `。`
// right before it and a CJK character right after, so the close doesn't
// qualify, and the whole run degrades to literal asterisks — the screen
// shows `**我们不拿你的访客数据卖广告。**` verbatim. The author sees bold
// text in Obsidian — **the product renders the owner's vault, and when the
// two disagree, the product is the one that's wrong.**
//
// This can't be worked around with a few local lines: by the time the
// asterisks reach here they're already plain text from the parse stage —
// what needs to change is micromark's attention tokenizer, and this plugin
// is exactly CommonMark's own CJK extension for that.
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

// renderCodeBlock —— special-case rendering for a fenced code block (mermaid / tikz / widget); otherwise returns null, falling back to plain code.
function renderCodeBlock(className: string, source: string): React.ReactElement | null {
  const renderer = BLOCK_RENDERERS[className.replace(/^language-/, '')];
  return renderer ? renderer(source) : null;
}

// LazyBlock —— wraps a lazily-rendered block (shared by mermaid / tikz) with Suspense + a loading fallback.
function LazyBlock(
  { kind, source, children }: { kind: string; source: string; children: React.ReactNode },
): React.ReactElement {
  return (
    <Suspense fallback={<pre data-testid={`${kind}-loading`}>{source}</pre>}>
      {children}
    </Suspense>
  );
}

// variant —— 'chat' (default) is the compact layout for chat replies;
// 'article' gives wiki / writing long-form reading an editorial-grade layout
// (p 21/1.65, h2 serif 26, blockquote 24 italic accent), see the .article
// modifier in ChatMarkdown.module.css. Both variants share the same
// markdown pipeline.
type MarkdownVariant = 'chat' | 'article';

// CorpusAnchor —— links inside the body text. A vault `[[X]]` is rewritten by
// the backend to `/wiki/<path>` before it ever reaches the markdown, without
// going through corpusHref — so the reader's chosen language would drop off
// **exactly the links inside the body text**, which are exactly the kind
// most often clicked mid-read. This wires them up; external links are left
// untouched.
function CorpusAnchor(props: React.ComponentPropsWithoutRef<'a'>): React.ReactElement {
  const withLang = useReaderLangHref();
  const { href, ...rest } = props;
  return <a href={withLang(href ?? '')} {...rest} />;
}

export function ChatMarkdown(
  { source, variant = 'chat' }: { source: string; variant?: MarkdownVariant },
): React.ReactElement {
  // styles.body scope —— in ChatMarkdown.module.css this fits table / pre /
  // code / blockquote / a / ul with the design palette (warm cream + ink + vermillion).
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
