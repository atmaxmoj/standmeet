// markdown.katex.test.tsx —— UT guarding the shared markdown render primitive (owner: "katex 是
// 工具箱里的东西,通用,需要测试守护"). rehype-katex lays out EVERY equation with inline `style`
// on its struts / vlists (strut heights, sub/superscript vertical offsets); rehype-sanitize strips
// `style`. So the plugin ORDER is load-bearing: sanitize must run BEFORE katex, or sanitize guts the
// math — struts collapse to 0, and ∑ / sub / superscripts overflow their box and overlap the text
// (F-R-3, second half). This UT renders the real ChatMarkdown to HTML and asserts katex's layout
// styles SURVIVE. A fast headless guard is the right shape here — the bug is in the render pipeline,
// not a full-stack flow (and the e2e `writing-math-mermaid` could never catch it: WritingArticle
// never sanitizes).

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ChatMarkdown } from '@/components/page/markdown';

describe('ChatMarkdown · KaTeX layout survives the sanitize pipeline', () => {
  // a sum + subscripts + superscript exercises struts AND vlists (the exact spans that lost their
  // inline style when sanitize ran after katex).
  const MATH = '$$\\sum_i x_i^2 = \\nabla f(x^\\ast)$$';

  it('renders display math', () => {
    const html = renderToStaticMarkup(<ChatMarkdown source={MATH} variant="article" />);
    expect(html).toContain('katex-display');
  });

  it('KEEPS katex inline styles — sanitize must run before katex (F-R-3 root cause)', () => {
    const html = renderToStaticMarkup(<ChatMarkdown source={MATH} variant="article" />);
    // The whole bug: sanitize stripping the inline `style` katex needs. If it ran after katex,
    // ZERO spans carry style. A correct pipeline keeps dozens.
    const styledSpans = (html.match(/<span[^>]*\sstyle="/g) ?? []).length;
    expect(
      styledSpans,
      'katex struts/vlists must keep inline style — 0 means sanitize stripped katex layout',
    ).toBeGreaterThan(3);
    // and specifically the strut that establishes equation height (its collapse caused the overlap)
    expect(html, 'the katex strut must keep its height (else the box collapses to one line)')
      .toMatch(/class="strut"[^>]*style="height:/);
  });
});
