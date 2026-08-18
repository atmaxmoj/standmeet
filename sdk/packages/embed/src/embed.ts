// embed.ts —— <standmeet-chat base-url="..." tier="public" code="...">
// Web Component。drop-in 单 <script> 给任意站点用。
//
// 内部不依赖 React；直接调 sdk-core 的 createClient + streamMessage，手写 DOM 渲染
// transcript：**问 = mono 小标题，答 = 衬线正文**，两种声音，跟设计稿一致。
//
// ⚠️ 这句话以前是**假的**：注释这么写着，而全文一行样式都没有 —— 裸 div 挂个 `data-role`
// 就交付给别人的站点了，字体颜色全靠宿主页面施舍，问和答同字号同色、连一轮的边界都看不出来
// （2026-08-13 的设计判定 🎨🔴 三条，全指这里）。**注释描述的是意图，不是结果。**
// 现在样式挂在 shadow root 里：宿主页面的 CSS 进不来，我们的也漏不出去 —— 这一面是
// 交付物，它必须自带产品身份，而不是长成它落在谁家的样子。
//
// v1 单 owner instance —— base-url 直接指向 owner 自己的 standmeet 部署，
// 不再有 handle attribute。
//
// 用法：
//   <script src="https://alice.dev/embed/embed.iife.js"></script>
//   <standmeet-chat base-url="https://alice.dev"></standmeet-chat>

import { createClient } from '@standmeet/sdk-core';
import type { StandMeetClient, SessionMode, SSEEvent } from '@standmeet/sdk-core';

const TAG = 'standmeet-chat';

// SHELL_CSS —— 这一面的产品身份。三件事，对应 2026-08-13 那三条设计判定：
//
//  1. **身份**：奶油纸 + 墨 + 朱红 + 衬线/mono 双字体。**不取外部字体** —— 一个 drop-in
//     脚本去 CDN 取字会在别人页面上多一次跨源请求，而且取不到时会静默换脸
//     （[[right-bytes-wrong-glyphs]]）。所以给的是字体栈：宿主装了 Newsreader 就用，
//     没装退到 Georgia —— 两种都还是衬线，声音不变。
//  2. **层级**：问是 mono 小标题（小、字距宽、muted），答是衬线正文（大、墨色、行距松）。
//     以前两者同字号同色，输入框反而带着浏览器默认的蓝焦点框最抢眼 —— 层级是反的。
//  3. **边界**：每一轮之间一条发丝线 + 留白，一眼数得出问了几轮。
const SHELL_CSS = `
  :host {
    --sm-paper: #F3EFE6; --sm-ink: #1B1814; --sm-muted: #7A7167;
    --sm-rule: #DCD3BF; --sm-accent: #B5391C;
    --sm-serif: 'Newsreader', Georgia, 'Times New Roman', serif;
    --sm-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
    display: block; background: var(--sm-paper); color: var(--sm-ink);
    border: 1px solid var(--sm-rule); border-radius: 3px;
    max-width: 46em; padding: 0;
  }
  [data-role="transcript"] { padding: 22px 24px 6px; }
  /* 一轮 = 问 + 答。轮与轮之间一条发丝线，边界看得见。 */
  [data-role="visitor"] {
    font-family: var(--sm-mono); font-size: 10.5px; letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--sm-muted);
    margin: 0 0 10px; padding-top: 18px; border-top: 1px solid var(--sm-rule);
  }
  [data-role="transcript"] > [data-role="visitor"]:first-child {
    padding-top: 0; border-top: none;
  }
  [data-role="assistant"] {
    font-family: var(--sm-serif); font-size: 16.5px; line-height: 1.62;
    color: var(--sm-ink); margin: 0 0 22px; white-space: pre-wrap;
  }
  /* 还没有字的答 = 正在想。纯 CSS，不新增任何事件或能力（进度那件事是 Result 列的）。 */
  [data-role="assistant"]:empty::after {
    content: '…'; color: var(--sm-muted); font-family: var(--sm-mono);
  }
  /* 段与行内标记（F-O-6）：答案里的粗体和行内代码现在渲成排版，不再把星号反引号原样印。
     注意这段注释在 SHELL_CSS 那个模板字符串里 —— 不能出现反引号，它会截断整个字符串。 */
  [data-role="assistant"] .para { margin: 0 0 0.85em; }
  [data-role="assistant"] .para:last-child { margin-bottom: 0; }
  [data-role="assistant"] strong { font-weight: 600; }
  [data-role="assistant"] code {
    font-family: var(--sm-mono); font-size: 0.88em;
    background: color-mix(in oklab, var(--sm-ink) 7%, transparent);
    padding: 0.1em 0.3em; border-radius: 2px;
  }
  /* 答案块本身不再 pre-wrap：分段现在由 .para 负责（pre-wrap 会把段间空行再算一次）。 */
  [data-role="assistant"] { white-space: normal; }
  textarea {
    display: block; width: 100%; box-sizing: border-box;
    font-family: var(--sm-mono); font-size: 13px; line-height: 1.5;
    color: var(--sm-ink); background: transparent;
    border: none; border-top: 1px solid var(--sm-rule);
    padding: 14px 24px 16px; resize: none; outline: none;
  }
  textarea::placeholder { color: var(--sm-muted); }
  /* 焦点用左边一道朱红，而不是浏览器默认那圈蓝框 —— 后者比答案还抢眼。 */
  textarea:focus { box-shadow: inset 2px 0 0 var(--sm-accent); }
`;

class StandMeetChatElement extends HTMLElement {
  private client: StandMeetClient | null = null;
  private session: { id: string; token: string; system: string } | null = null;
  private transcript: HTMLDivElement;
  private input: HTMLTextAreaElement;
  // pending / queue —— 这一场有没有一轮在飞，以及排在后面的问题。后端一场只跑一轮
  // （抢跑会被 429 拒，F-O-5），所以这里串行；但**不置灰**，排队是产品的活不是访客的
  // 纪律（F-A-42）。
  private pending = false;
  private readonly queue: string[] = [];

  constructor() {
    super();
    this.transcript = document.createElement('div');
    this.input = document.createElement('textarea');
  }

  connectedCallback(): void {
    const baseURL = this.getAttribute('base-url') ?? '';
    this.client = createClient({ baseURL });
    this.renderShell();
    this.input.addEventListener('keydown', this.onKeyDown);
  }

  disconnectedCallback(): void {
    this.input.removeEventListener('keydown', this.onKeyDown);
  }

  private renderShell(): void {
    this.transcript.setAttribute('data-role', 'transcript');
    this.input.setAttribute('placeholder', 'ask…');
    this.input.setAttribute('rows', '2');
    // shadow root：宿主页面的 CSS 进不来，我们的也漏不出去。交付给别人的东西必须两边都封。
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = SHELL_CSS;
    root.append(style, this.transcript, this.input);
  }

  // onKeyDown —— 一律**收下**这一问（F-O-5 → F-A-42）。
  //
  // 后端一场只跑一轮（`ErrSessionBusy` → 429），所以上一轮在流的时候直接再发会被拒，
  // 而访客读到的是「没发出去，再试一次」—— 两句都是假的。
  //
  // 我上一批的修法是**把输入框置灰**。那是错的，而且错得很典型：全局第 10 条写着
  // 「某个操作暂时做不了（忙／未就绪／冲突），**接受请求并排队，不要置灰**。置灰＝要求人
  // 守着屏幕等」。产品自己那张访客页也犯了同一个错，被 F-A-42 抓到 —— 一个长得完全就绪的
  // 框把访客打进去的字全吃掉。两面现在是同一套：收下、上屏、排队。
  private readonly onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Enter' || ev.shiftKey) return;
    ev.preventDefault();
    const text = this.input.value.trim();
    if (!text) return;
    this.input.value = '';
    this.enqueue(text);
  };

  // enqueue —— 问题当场上屏（访客看得见自己那句话还在），然后排队。
  private enqueue(text: string): void {
    this.appendBlock('visitor', text);
    this.queue.push(text);
    void this.drain();
  }

  // drain —— 一次只跑一轮（后端要求），但排在后面的自己会被取走跑掉，不用访客再打一遍。
  private async drain(): Promise<void> {
    if (this.pending) return;
    this.pending = true;
    try {
      for (let text = this.queue.shift(); text !== undefined; text = this.queue.shift()) {
        await this.runTurn(text);
      }
    } finally {
      this.pending = false;
    }
  }

  private async runTurn(text: string): Promise<void> {
    const assistant = this.appendBlock('assistant', '');
    try {
      await this.ensureSession();
      const sess = this.session;
      if (!sess) throw new Error('no session');
      if (!this.client) throw new Error('no client');
      for await (const ev of this.client.streamMessage(
        sess.id, sess.token, text, sess.system,
      )) {
        applyEventToBlock(assistant, ev);
      }
    } catch (e) {
      // 访客看得懂的话优先；技术细节留给 console（项目规矩：UI 上不出原始错误串）。
      // **按类别说**：一句话顶所有失败，就会在「其实发出去了」的时候叫人再试一次（F-O-5）。
      assistant.textContent = turnFailureText(e);
      console.error('[standmeet-chat] turn failed', e);
    }
  }

  private async ensureSession(): Promise<void> {
    if (this.session || !this.client) return;
    const mode = toMode(this.getAttribute('mode') ?? 'public');
    const code = this.getAttribute('code') ?? undefined;
    const s = await this.client.issueSession({ mode, code });
    // system prompt 一场拼一次：fragment + 这场的 persona。不拼的话模型收到的是空 system,
    // 于是它答得像个通用聊天机器人,跟这个 owner 无关（F-O-2）。
    this.session = {
      id: s.conversation_id, token: s.session_token,
      system: await this.client.composeSystem(s),
    };
  }

  private appendBlock(role: 'visitor' | 'assistant', text: string): HTMLDivElement {
    const div = document.createElement('div');
    div.setAttribute('data-role', role);
    div.textContent = text;
    this.transcript.appendChild(div);
    return div;
  }
}

// turnFailureText —— 这一轮为什么没成，**按类别说**（F-O-5）。
//
// 429 是「这一场正忙着」：上一轮还在流。它跟别的失败**要求的下一步不同** ——
// 那些可以再试一次，这个再试只会再被拒一次。以前一个 catch 把两者塌成同一句
// 「That did not go through. Please try again.」，于是在**其实发出去了**的时候
// 叫人再试（[[collapsed-error-class-kills-its-own-branch]]）。
//
// 现在 onKeyDown 那道闸让这一类基本到不了这里；留着是因为**闸挡不住所有来路**
// （多标签页、程序化调用），而那时这句话仍然得是对的。
function turnFailureText(e: unknown): string {
  const status = (e as { status?: unknown } | null)?.status;
  if (status === 429) return 'Still answering the previous question — one moment.';
  return 'That did not go through. Please try again.';
}

// applyEventToBlock —— 流式累加。**原文攒在 dataset 里，屏幕上渲的是排过版的那份**（F-O-6）。
//
// 以前这里直接 `textContent +=`，于是 `**这样**` 和反引号原样印给访客 —— 给模型的语法漏到
// 人眼前（同 F-R-7 的 `[[wikilink]]`）。产品自己的访客页会渲，embed 不会：又一次
// 「同一个能力两个面，只有一个面做了」。
function applyEventToBlock(block: HTMLDivElement, ev: SSEEvent): void {
  if (ev.kind === 'token') {
    block.dataset['raw'] = (block.dataset['raw'] ?? '') + ev.text;
    renderInline(block, block.dataset['raw']);
  } else if (ev.kind === 'error') {
    block.textContent = `error: ${ev.message}`;
  }
}

// renderInline —— 只认三样：`**粗**`、`` `代码` ``、空行分段。
//
// **不用 innerHTML，也不引 markdown 库**：这段代码跑在**别人的页面上**，一个 XSS 就是
// 别人域上的 XSS。这里全程 `createElement` + `textContent` 造 DOM —— 注入面从根上不存在，
// 不需要再挂一层消毒（真要上完整 markdown，得先把 rehype-sanitize 排在 rehype-katex 前面，
// [[katex-sanitize-order]]，那是另一件事，不在这条里做）。
//
// 三样是判断出来的，不是随手选的：这三种是模型答案里**真正高频**的标记，其余（表格、列表、
// 链接）在一个嵌进别人页面的小窗里本来就该退化成纯文本。
function renderInline(block: HTMLDivElement, raw: string): void {
  block.textContent = '';
  for (const para of raw.split(/\n{2,}/)) {
    if (para.trim() === '') continue;
    const p = document.createElement('div');
    p.className = 'para';
    for (const piece of splitMarks(para)) {
      p.appendChild(markToNode(piece));
    }
    block.appendChild(p);
  }
}

interface Mark { kind: 'text' | 'bold' | 'code'; text: string }

// splitMarks —— 把一段拆成 文本 / 粗体 / 行内代码。一遍正则，成对才算标记。
function splitMarks(s: string): Mark[] {
  const out: Mark[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  for (let m = re.exec(s); m !== null; m = re.exec(s)) {
    if (m.index > last) out.push({ kind: 'text', text: s.slice(last, m.index) });
    out.push(m[1] !== undefined
      ? { kind: 'bold', text: m[1] }
      : { kind: 'code', text: m[2] ?? '' });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ kind: 'text', text: s.slice(last) });
  return out;
}

function markToNode(m: Mark): Node {
  if (m.kind === 'text') return document.createTextNode(m.text);
  const el = document.createElement(m.kind === 'bold' ? 'strong' : 'code');
  el.textContent = m.text;
  return el;
}

const MODES: readonly SessionMode[] = ['public', 'code', 'byoai'];
function toMode(s: string): SessionMode {
  return MODES.find((m) => m === s) ?? 'public';
}

if (typeof customElements !== 'undefined' && !customElements.get(TAG)) {
  customElements.define(TAG, StandMeetChatElement);
}

export { StandMeetChatElement };
