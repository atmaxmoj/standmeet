// fixtures.ts —— D-6 chat-render fixtures。每个 key 对应一段 markdown
// 喂给 ChatMarkdown；spec 通过 ?fixture=key 选。

const FIXTURES: Record<string, string> = {
  markdown: [
    '# Heading',
    '',
    'A paragraph with **bold**, *italic*, and `inline code`.',
    '',
    '- item one',
    '- item two',
    '',
    '[link](https://example.com)',
  ].join('\n'),

  gfm: [
    '| col1 | col2 |',
    '| ---- | ---- |',
    '| a    | b    |',
    '',
    '~~strike~~',
    '',
    'https://example.com',
  ].join('\n'),

  katex: [
    'Inline: $E = mc^2$',
    '',
    'Display:',
    '',
    '$$',
    '\\int_0^1 x^2 dx',
    '$$',
  ].join('\n'),

  mermaid: [
    '```mermaid',
    'graph LR; A-->B',
    '```',
  ].join('\n'),

  xss: [
    'Before',
    '',
    '<script>window.__pwned = true</script>',
    '',
    '<img src="x" onerror="window.__pwned_img = true" />',
    '',
    'After',
  ].join('\n'),
};

export function fixtureFor(key: string): string {
  return FIXTURES[key] ?? FIXTURES['markdown'] ?? '';
}
