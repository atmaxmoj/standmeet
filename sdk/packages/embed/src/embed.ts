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

  private readonly onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Enter' || ev.shiftKey) return;
    ev.preventDefault();
    const text = this.input.value.trim();
    if (!text) return;
    this.input.value = '';
    void this.send(text);
  };

  private async send(text: string): Promise<void> {
    this.appendBlock('visitor', text);
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
      assistant.textContent = 'That did not go through. Please try again.';
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

function applyEventToBlock(block: HTMLDivElement, ev: SSEEvent): void {
  if (ev.kind === 'token') {
    block.textContent = (block.textContent ?? '') + ev.text;
  } else if (ev.kind === 'error') {
    block.textContent = `error: ${ev.message}`;
  }
}

const MODES: readonly SessionMode[] = ['public', 'code', 'byoai'];
function toMode(s: string): SessionMode {
  return MODES.find((m) => m === s) ?? 'public';
}

if (typeof customElements !== 'undefined' && !customElements.get(TAG)) {
  customElements.define(TAG, StandMeetChatElement);
}

export { StandMeetChatElement };
