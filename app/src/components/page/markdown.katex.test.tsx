// markdown.katex.test.tsx —— UT guarding the shared markdown render primitive (owner: "katex is
// a toolbox thing, general-purpose, needs test coverage"). rehype-katex lays out EVERY equation with inline `style`
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

  // F-R-4 —— what the visitor reads in a real vault note is raw TeX source:
  // in the middle of a proof, `$0<h_1<h_2, ,t=h_1/h_2, ,...` and a run of
  // `\varphi` `\le` appear, and the surrounding words get glued into
  // `dividingby` / `isnondecreasingandbounded`.
  //
  // The line below is the original text from that note
  // (cybernetics/.../adaptive-commitment-value.md:40), sitting inside a
  // triple-nested callout (`> > >`) — every other formula on the page
  // renders fine, so reproducing this requires moving the whole container it
  // sits in along with it.
  const PROOF_LINE =
    '> > > For $h>0$ let $D(h)=\\frac{\\varphi(a+h)-\\varphi(a)}{h}$. '
    + 'For $0<h_1<h_2$, $t=h_1/h_2$, $a+h_1=(1-t)a+t(a+h_2)$, so '
    + '$\\varphi(a+h_1)\\le(1-t)\\varphi(a)+t\\varphi(a+h_2)$; dividing by $h_1=th_2$ '
    + 'gives $D(h_1)\\le D(h_2)$.';

  it('renders every inline span inside a nested callout — no TeX source reaches the reader (F-R-4)', () => {
    const html = renderToStaticMarkup(<ChatMarkdown source={PROOF_LINE} variant="article" />);
    // katex itself echoes the raw TeX source back into <annotation> (MathML's
    // semantic branch), so checking "did any source leak in front of the
    // reader" requires stripping out the whole <math> block first — otherwise
    // this assertion would stay red forever, even after the fix.
    const visible = html.replace(/<math[\s\S]*?<\/math>/g, '');
    expect(visible, '一条 \\varphi 都不该以源码形态到达访客').not.toContain('\\varphi');
    expect(visible, '\\le 同理').not.toContain('\\le');
    expect(visible, '一个 $ 都不该剩下 —— 剩下就说明有一段没被当成公式').not.toContain('$');
    // Every `$...$` segment should become a katex node. There are 6 in the source.
    const katexNodes = (html.match(/class="katex"/g) ?? []).length;
    expect(katexNodes, '6 段行内公式,一段都不许漏').toBeGreaterThanOrEqual(6);
  });

  // The other half of the same change: the currency rule (#36/#40) must
  // still hold — the text between two amounts must not be swallowed as
  // math. These two assertions have to be read together: F-R-4's root cause
  // was exactly "the rule written for currency ate the formula next to it,"
  // and testing only one side would keep bouncing between the two
  // directions.
  it('two currency amounts in one sentence stay literal (#36/#40 still holds)', () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown source="Pricing: it cost $100 up front and $200 on renewal." variant="article" />,
    );
    expect(html, '两个金额都要原样出现').toContain('$100');
    expect(html).toContain('$200');
    expect(html, '中间那段话不许被当成公式').not.toContain('class="katex"');
  });
});
