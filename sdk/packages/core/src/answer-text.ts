// answer-text.ts —— 把模型答案里那点行内标记**解析**成段落和片段。只解析，不渲染。
//
// 为什么住在 core（F-O-8）：这个 SDK 有两个渲染面 —— web component 自己拼 DOM 节点，
// React 绑定把文本交给宿主。之前只有 web component 认得 `**粗**` 和 `` `码` ``，于是同一个
// 产品在两个面上一个渲成排版、一个把星号原样印给访客（F-O-6 的症状，换了个面又长出来一次）。
//
// 解析和渲染分开，是因为**两个面能共用的只有解析**：一个要 `document.createElement`，
// 另一个要 React 元素。把解析放在共用处、渲染各自实现，比让某一面去 import 另一面的 DOM 代码
// 干净，也比让两边各写一遍正则可靠 —— 那第二份迟早跟第一份漂开
// （[[test-only-helper-rots-non-test-callers]] 的同一族：抽出不依赖宿主的核，两边都走它）。
//
// 只认三样：段落（空行分段）、`**粗体**`、`` `行内代码` ``。**不引 markdown 库**：渲染这一侧
// 全部走 `textContent` / React 文本节点，注入面从根上不存在，不需要再挂一层消毒。

/** 一段文字里的一个片段：普通文本、粗体、斜体，或行内代码。 */
export interface AnswerSpan { kind: 'text' | 'bold' | 'italic' | 'code'; text: string }

/** 解析后的答案：段落数组，每段是片段数组。 */
export type AnswerParagraphs = AnswerSpan[][];

export function parseAnswerText(raw: string): AnswerParagraphs {
  const out: AnswerParagraphs = [];
  for (const para of raw.split(/\n{2,}/)) {
    if (para.trim() === '') continue;
    out.push(splitSpans(para));
  }
  return out;
}

// splitSpans —— 一遍正则，成对才算标记（落单的星号/反引号照旧当普通字符）。
//
// **`**粗**` 必须排在 `*斜*` 前面**：交替是从左往右试的，反过来的话 `*` 会先咬掉
// `**` 的第一颗星，粗体从此再也匹配不上（[[lookahead-rule-eats-the-neighbour]]）。
// 斜体那一支还禁掉了星号和换行，免得跨段吞字。
function splitSpans(s: string): AnswerSpan[] {
  const out: AnswerSpan[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*\n]+)\*|`([^`]+)`/g;
  let last = 0;
  for (let m = re.exec(s); m !== null; m = re.exec(s)) {
    if (m.index > last) out.push({ kind: 'text', text: s.slice(last, m.index) });
    out.push(spanOf(m));
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ kind: 'text', text: s.slice(last) });
  return out;
}

function spanOf(m: RegExpExecArray): AnswerSpan {
  if (m[1] !== undefined) return { kind: 'bold', text: m[1] };
  if (m[2] !== undefined) return { kind: 'italic', text: m[2] };
  return { kind: 'code', text: m[3] ?? '' };
}
